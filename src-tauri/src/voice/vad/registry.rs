use crate::voice::vad::contracts::{VadError, VadManifest, VadStatus, VadStrategy};
use crate::voice::vad::settings::{ENERGY_BASIC_ID, MICROTURN_V1_ID, SHERPA_SILERO_ID};
use crate::voice::vad::strategies::energy_basic::EnergyBasicStrategy;
use crate::voice::vad::strategies::microturn_v1::MicroturnV1Strategy;
use crate::voice::vad::strategies::sherpa_silero::SherpaSileroStrategy;

pub fn list_methods(include_experimental: bool) -> Vec<VadManifest> {
    [energy_manifest(), sherpa_manifest(), microturn_manifest()]
        .into_iter()
        .filter(|manifest| is_visible(manifest, include_experimental))
        .collect()
}

pub fn validate_method(method_id: &str) -> Result<(), VadError> {
    if all_manifests()
        .iter()
        .any(|manifest| manifest.id == method_id)
    {
        Ok(())
    } else {
        Err(VadError::UnknownMethod(format!(
            "unknown VAD method '{method_id}'"
        )))
    }
}

pub fn manifest(method_id: &str) -> Result<VadManifest, VadError> {
    all_manifests()
        .into_iter()
        .find(|manifest| manifest.id == method_id)
        .ok_or_else(|| VadError::UnknownMethod(format!("unknown VAD method '{method_id}'")))
}

pub fn instantiate(method_id: &str) -> Result<Box<dyn VadStrategy>, VadError> {
    match method_id {
        ENERGY_BASIC_ID => Ok(Box::<EnergyBasicStrategy>::default()),
        SHERPA_SILERO_ID => Ok(Box::<SherpaSileroStrategy>::default()),
        MICROTURN_V1_ID => Ok(Box::<MicroturnV1Strategy>::default()),
        _ => Err(VadError::UnknownMethod(format!(
            "unknown VAD method '{method_id}'"
        ))),
    }
}

fn all_manifests() -> Vec<VadManifest> {
    vec![energy_manifest(), sherpa_manifest(), microturn_manifest()]
}

fn is_visible(manifest: &VadManifest, include_experimental: bool) -> bool {
    match manifest.status {
        VadStatus::Stable | VadStatus::Deprecated => true,
        VadStatus::Experimental => include_experimental,
        VadStatus::Hidden => false,
    }
}

fn energy_manifest() -> VadManifest {
    EnergyBasicStrategy::manifest_static()
}

fn sherpa_manifest() -> VadManifest {
    SherpaSileroStrategy::manifest_static()
}

fn microturn_manifest() -> VadManifest {
    MicroturnV1Strategy::manifest_static()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_list_excludes_experimental_by_default() {
        let methods = list_methods(false);
        assert!(methods.iter().any(|method| method.id == ENERGY_BASIC_ID));
        assert!(methods.iter().any(|method| method.id == SHERPA_SILERO_ID));
        assert!(!methods.iter().any(|method| method.id == MICROTURN_V1_ID));
    }

    #[test]
    fn experimental_methods_require_explicit_visibility() {
        let methods = list_methods(true);
        assert!(methods.iter().any(|method| method.id == MICROTURN_V1_ID));
    }
}
