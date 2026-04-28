use crate::app_paths;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

const SERVICE_NAME: &str = app_paths::APP_IDENTIFIER;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SecretKey {
    account: String,
}

impl SecretKey {
    pub fn api_connection(id: &str) -> Self {
        Self {
            account: format!("api-connection:{id}"),
        }
    }

    fn account(&self) -> &str {
        self.account.as_str()
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct SecretValue(String);

impl SecretValue {
    pub fn new(value: String) -> Self {
        Self(value)
    }

    pub fn expose(self) -> String {
        self.0
    }

    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

impl std::fmt::Debug for SecretValue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SecretValue(<redacted>)")
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SecretStoreError {
    #[error("secure credential storage is unavailable; plaintext fallback requires explicit acknowledgement")]
    Unavailable,
    #[error("failed accessing OS credential storage")]
    OsStore,
    #[error("failed accessing plaintext fallback secret store")]
    PlaintextStore,
}

pub trait SecretStore: Send + Sync {
    fn set_secret(&self, key: &SecretKey, value: &SecretValue) -> Result<(), SecretStoreError>;
    fn get_secret(&self, key: &SecretKey) -> Result<Option<SecretValue>, SecretStoreError>;
    fn delete_secret(&self, key: &SecretKey) -> Result<(), SecretStoreError>;
    fn is_available(&self) -> bool;
    fn backend_name(&self) -> &'static str;
}

pub struct AppSecretStore {
    plaintext_path: PathBuf,
    plaintext_allowed: RwLock<bool>,
}

impl AppSecretStore {
    pub fn new(app_data_root: PathBuf) -> Self {
        let plaintext_allowed = std::env::var("ARXELL_ALLOW_PLAINTEXT_SECRETS")
            .ok()
            .map(|value| matches!(value.trim(), "1" | "true" | "yes"))
            .unwrap_or(false);
        Self {
            plaintext_path: app_data_root.join("api-secrets.plaintext.json"),
            plaintext_allowed: RwLock::new(plaintext_allowed),
        }
    }

    pub fn acknowledge_plaintext_fallback(&self) {
        let mut allowed = self
            .plaintext_allowed
            .write()
            .expect("secret store lock poisoned");
        *allowed = true;
    }

    pub fn plaintext_fallback_allowed(&self) -> bool {
        *self
            .plaintext_allowed
            .read()
            .expect("secret store lock poisoned")
    }

    pub fn can_use_os_store(&self) -> bool {
        let probe = SecretKey {
            account: "availability-probe".to_string(),
        };
        let Ok(entry) = keyring::Entry::new(SERVICE_NAME, probe.account()) else {
            return false;
        };
        match entry.get_password() {
            Ok(_) | Err(keyring::Error::NoEntry) => true,
            Err(_) => false,
        }
    }

    fn set_os_secret(&self, key: &SecretKey, value: &SecretValue) -> Result<(), SecretStoreError> {
        let entry = keyring::Entry::new(SERVICE_NAME, key.account())
            .map_err(|_| SecretStoreError::OsStore)?;
        entry
            .set_password(value.as_str())
            .map_err(|_| SecretStoreError::OsStore)
    }

    fn get_os_secret(&self, key: &SecretKey) -> Result<Option<SecretValue>, SecretStoreError> {
        let entry = keyring::Entry::new(SERVICE_NAME, key.account())
            .map_err(|_| SecretStoreError::OsStore)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(SecretValue::new(value))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(SecretStoreError::OsStore),
        }
    }

    fn delete_os_secret(&self, key: &SecretKey) -> Result<(), SecretStoreError> {
        let entry = keyring::Entry::new(SERVICE_NAME, key.account())
            .map_err(|_| SecretStoreError::OsStore)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(SecretStoreError::OsStore),
        }
    }

    fn read_plaintext(&self) -> Result<PlaintextSecrets, SecretStoreError> {
        let Ok(raw) = fs::read_to_string(&self.plaintext_path) else {
            return Ok(PlaintextSecrets::default());
        };
        serde_json::from_str(&raw).map_err(|_| SecretStoreError::PlaintextStore)
    }

    fn write_plaintext(&self, secrets: &PlaintextSecrets) -> Result<(), SecretStoreError> {
        let Some(parent) = self.plaintext_path.parent() else {
            return Err(SecretStoreError::PlaintextStore);
        };
        fs::create_dir_all(parent).map_err(|_| SecretStoreError::PlaintextStore)?;
        let payload =
            serde_json::to_string_pretty(secrets).map_err(|_| SecretStoreError::PlaintextStore)?;
        let tmp_path = self.plaintext_path.with_extension("json.tmp");
        fs::write(&tmp_path, format!("{payload}\n"))
            .map_err(|_| SecretStoreError::PlaintextStore)?;
        fs::rename(&tmp_path, &self.plaintext_path).map_err(|_| SecretStoreError::PlaintextStore)
    }

    fn set_plaintext_secret(
        &self,
        key: &SecretKey,
        value: &SecretValue,
    ) -> Result<(), SecretStoreError> {
        let mut secrets = self.read_plaintext()?;
        secrets
            .secrets
            .insert(key.account().to_string(), value.as_str().to_string());
        self.write_plaintext(&secrets)
    }

    fn get_plaintext_secret(
        &self,
        key: &SecretKey,
    ) -> Result<Option<SecretValue>, SecretStoreError> {
        let secrets = self.read_plaintext()?;
        Ok(secrets
            .secrets
            .get(key.account())
            .cloned()
            .map(SecretValue::new))
    }

    fn delete_plaintext_secret(&self, key: &SecretKey) -> Result<(), SecretStoreError> {
        let mut secrets = self.read_plaintext()?;
        secrets.secrets.remove(key.account());
        self.write_plaintext(&secrets)
    }
}

impl SecretStore for AppSecretStore {
    fn set_secret(&self, key: &SecretKey, value: &SecretValue) -> Result<(), SecretStoreError> {
        if self.set_os_secret(key, value).is_ok() {
            if matches!(self.get_os_secret(key), Ok(Some(stored)) if stored.as_str() == value.as_str())
            {
                return Ok(());
            }
        }
        if self.plaintext_fallback_allowed() {
            return self.set_plaintext_secret(key, value);
        }
        Err(SecretStoreError::Unavailable)
    }

    fn get_secret(&self, key: &SecretKey) -> Result<Option<SecretValue>, SecretStoreError> {
        match self.get_os_secret(key) {
            Ok(Some(value)) => Ok(Some(value)),
            Ok(None) => self.get_plaintext_secret(key),
            Err(_) => self.get_plaintext_secret(key),
        }
    }

    fn delete_secret(&self, key: &SecretKey) -> Result<(), SecretStoreError> {
        let _ = self.delete_os_secret(key);
        if self.plaintext_fallback_allowed() {
            let _ = self.delete_plaintext_secret(key);
        }
        Ok(())
    }

    fn is_available(&self) -> bool {
        self.can_use_os_store() || self.plaintext_fallback_allowed()
    }

    fn backend_name(&self) -> &'static str {
        if self.can_use_os_store() {
            "os-keychain"
        } else if self.plaintext_fallback_allowed() {
            "plaintext-fallback"
        } else {
            "unavailable"
        }
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct PlaintextSecrets {
    #[serde(default)]
    secrets: HashMap<String, String>,
}

pub fn redacted_error(error: SecretStoreError) -> String {
    error.to_string()
}

#[allow(dead_code)]
fn _assert_path_send_sync(_: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_value_debug_is_redacted() {
        let value = SecretValue::new("sk-test-secret".to_string());
        assert_eq!(format!("{value:?}"), "SecretValue(<redacted>)");
    }

    #[test]
    fn secret_key_is_namespaced_by_connection_id() {
        let key = SecretKey::api_connection("api-1");
        assert_eq!(key.account(), "api-connection:api-1");
    }
}
