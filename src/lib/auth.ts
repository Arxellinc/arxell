import { useAuth } from "@clerk/react-router";
import { isClerkEnabled } from "./runtimeFlags";

type GetTokenOptions = {
  template?: string;
};

type OptionalAuth = {
  clerkEnabled: boolean;
  isSignedIn: boolean;
  getToken: (options?: GetTokenOptions) => Promise<string | null>;
};

const NO_AUTH: OptionalAuth = {
  clerkEnabled: false,
  isSignedIn: false,
  getToken: async () => null,
};

export function useOptionalAuth(): OptionalAuth {
  const clerkEnabled = isClerkEnabled();
  if (!clerkEnabled) {
    return NO_AUTH;
  }

  try {
    const auth = useAuth();
    return {
      clerkEnabled: true,
      isSignedIn: Boolean(auth.isSignedIn),
      getToken: auth.getToken,
    };
  } catch {
    return NO_AUTH;
  }
}
