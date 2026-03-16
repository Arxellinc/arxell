use arx_rs::{provider::mock::MockProvider, Agent, AgentConfig, Session};

#[tokio::test]
async fn test_agent_single_turn_runs() {
    let session = Session::in_memory(".".to_string(), None, None, "medium".to_string());
    let provider = Box::new(MockProvider::default());
    let mut agent = Agent::new(
        provider,
        arx_rs::tools::default_tools(),
        session,
        AgentConfig {
            max_turns: Some(1),
            context_window: None,
            max_output_tokens: None,
        },
        None,
    )
    .expect("agent should initialize");

    let events = agent.run_collect("hello".to_string(), None, None).await;
    assert!(!events.is_empty());

    let has_agent_start = events.iter().any(|e| matches!(e, arx_rs::events::Event::AgentStart));
    let has_turn_end = events
        .iter()
        .any(|e| matches!(e, arx_rs::events::Event::TurnEnd { .. }));
    let has_agent_end = events
        .iter()
        .any(|e| matches!(e, arx_rs::events::Event::AgentEnd { .. }));

    assert!(has_agent_start);
    assert!(has_turn_end);
    assert!(has_agent_end);
}

#[tokio::test]
async fn test_session_roundtrip() {
    let dir = tempfile::tempdir().expect("tempdir");
    let cwd = dir.path().display().to_string();

    let mut session = Session::create(
        cwd.clone(),
        true,
        Some("openai".to_string()),
        Some("gpt-4.1".to_string()),
        "medium".to_string(),
    )
    .expect("session create");

    let _ = session.append_message(arx_rs::types::Message::User {
        content: arx_rs::types::UserContent::Text("hello".to_string()),
    });
    let _ = session.append_message(arx_rs::types::Message::Assistant {
        content: vec![arx_rs::types::ContentPart::Text {
            text: "hi".to_string(),
        }],
        usage: None,
        stop_reason: Some(arx_rs::types::StopReason::Stop),
    });

    let path = session
        .session_file
        .clone()
        .expect("session file should exist after assistant");

    let loaded = Session::load(path).expect("load session");
    assert_eq!(loaded.all_messages().len(), 2);
}
