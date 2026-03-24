use std::sync::atomic::Ordering;

use arx_lib::test_support::{
    bridge_cancel_slice, bridge_send_message_slice, build_bridge_test_state,
    seed_bridge_conversation, CancelRunCommand, SendMessageCommand,
};

#[test]
fn integration_bridge_slice_send_persist_and_cancel() {
    let state = build_bridge_test_state().expect("build bridge test state");
    let conversation_id = "conv-integration-bridge-1";
    seed_bridge_conversation(&state, conversation_id).expect("seed conversation");

    let send_result = bridge_send_message_slice(
        &state,
        SendMessageCommand {
            correlation_id: "corr-integration-1".to_string(),
            conversation_id: conversation_id.to_string(),
            content: "ping".to_string(),
            extra_context: None,
            thinking_enabled: None,
            assistant_msg_id: Some("assistant-integration-1".to_string()),
            screenshot_base64: None,
            mode_id: None,
        },
    )
    .expect("send through bridge slice");

    assert_eq!(send_result.user_message.role, "user");
    assert_eq!(send_result.user_message.content, "ping");

    let db = state.db.lock().expect("lock db");
    let count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM messages WHERE conversation_id = ?1",
            rusqlite::params![conversation_id],
            |row| row.get(0),
        )
        .expect("count persisted messages");
    assert_eq!(count, 2);

    let assistant_content: String = db
        .query_row(
            "SELECT content FROM messages WHERE role = 'assistant' ORDER BY created_at DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .expect("load assistant content");
    assert_eq!(assistant_content, "bridge hello");
    drop(db);

    bridge_cancel_slice(
        &state,
        CancelRunCommand {
            correlation_id: "corr-integration-1".to_string(),
            run_id: Some("run-integration-1".to_string()),
        },
    )
    .expect("cancel through bridge slice");

    assert!(state.chat_cancel.load(Ordering::SeqCst));
}
