use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, StreamTrait};
use cpal::{Device, SampleFormat, SampleRate, Stream, StreamConfig, SupportedStreamConfig};

struct FormatCandidate {
    channels: u16,
    sample_rate: u32,
    sample_format: SampleFormat,
}

const FORMAT_PRIORITY: &[FormatCandidate] = &[
    FormatCandidate {
        channels: 1,
        sample_rate: 48_000,
        sample_format: SampleFormat::F32,
    },
    FormatCandidate {
        channels: 1,
        sample_rate: 44_100,
        sample_format: SampleFormat::F32,
    },
    FormatCandidate {
        channels: 1,
        sample_rate: 16_000,
        sample_format: SampleFormat::F32,
    },
    FormatCandidate {
        channels: 2,
        sample_rate: 48_000,
        sample_format: SampleFormat::F32,
    },
    FormatCandidate {
        channels: 1,
        sample_rate: 48_000,
        sample_format: SampleFormat::I16,
    },
];

pub fn open_input_stream(device: &Device) -> Result<Stream> {
    let supported = device
        .supported_input_configs()
        .map_err(|e| anyhow!("Could not query supported configs: {e}"))?
        .collect::<Vec<_>>();

    if supported.is_empty() {
        return Err(anyhow!("Device reports no supported input configs"));
    }

    let selected: SupportedStreamConfig = FORMAT_PRIORITY
        .iter()
        .find_map(|candidate| {
            supported.iter().find_map(|s| {
                let rate = SampleRate(candidate.sample_rate);
                if s.channels() == candidate.channels
                    && s.sample_format() == candidate.sample_format
                    && s.min_sample_rate() <= rate
                    && s.max_sample_rate() >= rate
                {
                    Some(s.with_sample_rate(rate))
                } else {
                    None
                }
            })
        })
        .unwrap_or_else(|| supported[0].with_max_sample_rate());

    let config: StreamConfig = selected.clone().into();

    log::info!(
        "[audio] opening input stream device='{}' channels={} rate={}",
        device.name().unwrap_or_default(),
        config.channels,
        config.sample_rate.0
    );

    let stream = match selected.sample_format() {
        SampleFormat::F32 => device.build_input_stream(
            &config,
            move |_data: &[f32], _| {},
            |err| {
                log::error!("[audio] cpal stream error: {}", err);
            },
            None,
        )?,
        SampleFormat::I16 => device.build_input_stream(
            &config,
            move |_data: &[i16], _| {},
            |err| {
                log::error!("[audio] cpal stream error: {}", err);
            },
            None,
        )?,
        SampleFormat::U16 => device.build_input_stream(
            &config,
            move |_data: &[u16], _| {},
            |err| {
                log::error!("[audio] cpal stream error: {}", err);
            },
            None,
        )?,
        _ => {
            return Err(anyhow!(
                "Unsupported sample format {:?}",
                selected.sample_format()
            ))
        }
    };

    stream.play()?;
    Ok(stream)
}

pub use cpal::StreamError;
