/** Model Stop must not wait for speech-stop IPC, including failures. Observe
 * both operations independently, but finish once model cancellation settles.
 */
export async function requestChatStop(
  cancelModel: () => Promise<unknown>,
  stopSpeech: () => Promise<unknown>,
  onFailure: (target: "model" | "speech", error: unknown) => void
): Promise<void> {
  const observe = async (target: "model" | "speech", operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      onFailure(target, error);
    }
  };
  const cancellation = observe("model", cancelModel);
  void observe("speech", stopSpeech);
  await cancellation;
}
