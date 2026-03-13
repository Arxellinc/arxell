import { useAuth } from "@clerk/react-router";

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
  const clerkEnabled = Boolean(
    (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "").trim()
  );
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
