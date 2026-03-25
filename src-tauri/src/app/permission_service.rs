use crate::contracts::{
    DevicesProbeMicrophoneRequest, DevicesProbeMicrophoneResponse, EventSeverity, EventStage,
    Subsystem,
};
use crate::observability::EventHub;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde_json::json;

pub struct PermissionService {
    hub: EventHub,
}

impl PermissionService {
    pub fn new(hub: EventHub) -> Self {
        Self { hub }
    }

    pub fn probe_microphone(
        &self,
        request: DevicesProbeMicrophoneRequest,
    ) -> Result<DevicesProbeMicrophoneResponse, String> {
        self.emit(
            request.correlation_id.as_str(),
            EventStage::Start,
            EventSeverity::Info,
            json!({
                "attemptOpen": request.attempt_open.unwrap_or(false),
            }),
        );

        let response = self.probe_microphone_inner(&request)?;
        let severity = if response.status == "enabled" {
            EventSeverity::Info
        } else if response.status == "no_device" {
            EventSeverity::Warn
        } else {
            EventSeverity::Info
        };
        self.emit(
            request.correlation_id.as_str(),
            EventStage::Complete,
            severity,
            json!({
                "status": response.status,
                "message": response.message,
                "inputDeviceCount": response.input_device_count,
                "defaultInputName": response.default_input_name,
            }),
        );
        Ok(response)
    }

    fn probe_microphone_inner(
        &self,
        request: &DevicesProbeMicrophoneRequest,
    ) -> Result<DevicesProbeMicrophoneResponse, String> {
        let host = cpal::default_host();
        let should_open = request.attempt_open.unwrap_or(false);
        let default_input = host.default_input_device();
        let default_name = default_input.as_ref().and_then(|device| device.name().ok());
        let input_count = if default_input.is_some() { 1 } else { 0 };

        if default_input.is_none() {
            return Ok(DevicesProbeMicrophoneResponse {
                correlation_id: request.correlation_id.clone(),
                status: "no_device".to_string(),
                message: "No microphone device detected".to_string(),
                input_device_count: input_count,
                default_input_name: default_name,
            });
        }

        if !should_open {
            return Ok(DevicesProbeMicrophoneResponse {
                correlation_id: request.correlation_id.clone(),
                status: "not_enabled".to_string(),
                message: "Microphone available; awaiting enable action".to_string(),
                input_device_count: input_count,
                default_input_name: default_name,
            });
        }

        let device = default_input.expect("checked default_input is_some");
        let config = match device.default_input_config() {
            Ok(config) => config,
            Err(err) => {
                return Ok(DevicesProbeMicrophoneResponse {
                    correlation_id: request.correlation_id.clone(),
                    status: "not_enabled".to_string(),
                    message: format!("Failed to query default microphone config: {err}"),
                    input_device_count: input_count,
                    default_input_name: default_name,
                })
            }
        };

        let stream_config = config.config();
        let stream_result = match config.sample_format() {
            cpal::SampleFormat::F32 => build_probe_stream::<f32>(&device, &stream_config),
            cpal::SampleFormat::I8 => build_probe_stream::<i8>(&device, &stream_config),
            cpal::SampleFormat::I16 => build_probe_stream::<i16>(&device, &stream_config),
            cpal::SampleFormat::I32 => build_probe_stream::<i32>(&device, &stream_config),
            cpal::SampleFormat::I64 => build_probe_stream::<i64>(&device, &stream_config),
            cpal::SampleFormat::U8 => build_probe_stream::<u8>(&device, &stream_config),
            cpal::SampleFormat::U16 => build_probe_stream::<u16>(&device, &stream_config),
            cpal::SampleFormat::U32 => build_probe_stream::<u32>(&device, &stream_config),
            cpal::SampleFormat::U64 => build_probe_stream::<u64>(&device, &stream_config),
            _ => Err("Unsupported sample format for microphone probe".to_string()),
        };

        let stream = match stream_result {
            Ok(stream) => stream,
            Err(err) => {
                return Ok(DevicesProbeMicrophoneResponse {
                    correlation_id: request.correlation_id.clone(),
                    status: "not_enabled".to_string(),
                    message: format!("Microphone probe failed: {err}"),
                    input_device_count: input_count,
                    default_input_name: default_name,
                })
            }
        };

        if let Err(err) = stream.play() {
            return Ok(DevicesProbeMicrophoneResponse {
                correlation_id: request.correlation_id.clone(),
                status: "not_enabled".to_string(),
                message: format!("Failed to start microphone probe stream: {err}"),
                input_device_count: input_count,
                default_input_name: default_name,
            });
        }

        std::thread::sleep(std::time::Duration::from_millis(120));
        drop(stream);

        Ok(DevicesProbeMicrophoneResponse {
            correlation_id: request.correlation_id.clone(),
            status: "enabled".to_string(),
            message: "Microphone probe succeeded".to_string(),
            input_device_count: input_count,
            default_input_name: default_name,
        })
    }

    fn emit(
        &self,
        correlation_id: &str,
        stage: EventStage,
        severity: EventSeverity,
        payload: serde_json::Value,
    ) {
        self.hub.emit(self.hub.make_event(
            correlation_id,
            Subsystem::Runtime,
            "devices.microphone.probe",
            stage,
            severity,
            payload,
        ));
    }
}

fn build_probe_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
) -> Result<cpal::Stream, String>
where
    T: cpal::SizedSample + Send + 'static,
{
    device
        .build_input_stream(
            config,
            move |_data: &[T], _info: &cpal::InputCallbackInfo| {},
            move |_err| {},
            None,
        )
        .map_err(|e| e.to_string())
}
