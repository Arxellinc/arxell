use arx_domain::{DomainError, RunId};

use crate::ports::RunStore;

pub struct CancelRunInput {
    pub run_id: RunId,
}

pub struct CancelRunResult {
    pub cancelled: bool,
}

pub struct CancelRunUseCase<'a> {
    pub run_store: &'a dyn RunStore,
}

impl<'a> CancelRunUseCase<'a> {
    pub fn execute(&self, input: CancelRunInput) -> Result<CancelRunResult, DomainError> {
        let cancelled = self.run_store.cancel_run(&input.run_id)?;
        Ok(CancelRunResult { cancelled })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use arx_domain::CorrelationId;

    struct FakeRunStore {
        cancel_result: bool,
    }

    impl RunStore for FakeRunStore {
        fn start_run(
            &self,
            _run_id: RunId,
            _correlation_id: CorrelationId,
        ) -> Result<(), DomainError> {
            Ok(())
        }

        fn cancel_run(&self, _run_id: &RunId) -> Result<bool, DomainError> {
            Ok(self.cancel_result)
        }
    }

    #[test]
    fn cancel_run_returns_store_result() {
        let use_case = CancelRunUseCase {
            run_store: &FakeRunStore {
                cancel_result: true,
            },
        };
        let output = use_case
            .execute(CancelRunInput {
                run_id: RunId::new("run-1").unwrap(),
            })
            .unwrap();
        assert!(output.cancelled);
    }
}
