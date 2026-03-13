import { create } from "zustand";

interface SystemAlertStore {
  alerts: string[];
  addAlert: (message: string) => void;
  clearAlert: (message: string) => void;
  clearAll: () => void;
}

export const useSystemAlertStore = create<SystemAlertStore>((set) => ({
  alerts: [],
  addAlert: (message) =>
    set((state) => {
      if (!message.trim()) return state;
      if (state.alerts.includes(message)) return state;
      return { alerts: [message, ...state.alerts].slice(0, 12) };
    }),
  clearAlert: (message) =>
    set((state) => ({
      alerts: state.alerts.filter((m) => m !== message),
    })),
  clearAll: () => set({ alerts: [] }),
}));
