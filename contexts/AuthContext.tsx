import React, { createContext, useContext, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Platform, InteractionManager } from 'react-native';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signUp: (email: string, password: string, fullName: string) => Promise<any>;
  signIn: (email: string, password: string) => Promise<any>;
  signOut: () => Promise<void>;
}

import { notificationService } from './NotificationService';
import { isStrongPassword, PASSWORD_RULE_DESCRIPTION } from '@/utils/passwordPolicy';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let interactionHandle: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;

    const runRestoreSession = async () => {
      if (cancelled) return;
      console.log("🔄 restoreSession() start");
      try {
        const { data, error } = await supabase.auth.getSession();
        console.log("🔍 getSession returned:", data, error);

        if (error) {
          console.warn("⚠️ restoreSession error:", error.message);
          await supabase.auth.signOut();
          if (!cancelled) {
            setSession(null);
            setUser(null);
          }
          return;
        }

        if (data?.session) {
          if (!cancelled) {
            setSession(data.session);
            setUser(data.session.user);
          }
        } else {
          console.log("❎ No session data in this tab");
          if (!cancelled) {
            setSession(null);
            setUser(null);
          }
        }
      } catch (err) {
        console.error("❌ restoreSession exception:", err);
      } finally {
        if (!cancelled) {
          setLoading(false);
          console.log("✅ restoreSession ended, loading=false");
        }
      }
    };

    const scheduleRestoreSession = () => {
      if (Platform.OS === "web") {
        runRestoreSession();
        return;
      }
      interactionHandle?.cancel?.();
      interactionHandle = InteractionManager.runAfterInteractions(() => {
        runRestoreSession();
      });
    };

    const webFocusHandler = () => scheduleRestoreSession();
    const visibilityHandler = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        scheduleRestoreSession();
      }
    };

    if (
      Platform.OS === "web" &&
      typeof window !== "undefined" &&
      typeof window.addEventListener === "function"
    ) {
      window.addEventListener("focus", webFocusHandler);
      window.addEventListener("visibilitychange", visibilityHandler);
    }

    scheduleRestoreSession();

    const { data: listener } = supabase.auth.onAuthStateChange((event, sess) => {
      console.log("🔔 onAuthStateChange:", event, sess);
      if (!cancelled) {
        setSession(sess);
        setUser(sess?.user ?? null);
        setLoading(false);
      }

      if (event === "SIGNED_IN" && sess) {
        const { user } = sess;
        (async () => {
          try {
            await notificationService.initialize(user.id);
          } catch (err: any) {
            console.log("⚠️ Notification init skipped:", err?.message || err);
          }
        })();

        (async () => {
          try {
            const { data: p, error: pErr } = await supabase
              .from("profiles")
              .select("id")
              .eq("id", user.id);
            if (pErr) throw pErr;
            if (!p || p.length === 0) {
              const { error: insErr } = await supabase.from("profiles").insert({
                id: user.id,
                email: user.email!,
                full_name: user.user_metadata.full_name,
              });
              if (insErr) throw insErr;
            }
          } catch (e) {
            console.error("⚠️ Profile creation error:", e);
          }
        })();
      }
    });

    return () => {
      cancelled = true;
      interactionHandle?.cancel?.();
      listener.subscription.unsubscribe();
      if (
        Platform.OS === "web" &&
        typeof window !== "undefined" &&
        typeof window.removeEventListener === "function"
      ) {
        window.removeEventListener("focus", webFocusHandler);
        window.removeEventListener("visibilitychange", visibilityHandler);
      }
    };
  }, []);

  const signUp = async (email: string, password: string, fullName: string) => {
    if (!isStrongPassword(password)) {
      throw new Error(PASSWORD_RULE_DESCRIPTION);
    }

    const policyPayload = {
      password,
      action_type: 'signup',
      user_id: email.trim().toLowerCase(),
    };

    const { data: policyData, error: policyError } = await supabase.functions.invoke('password-policy', {
      body: policyPayload,
    });

    if (policyError) {
      throw new Error((policyError as Error)?.message || 'Failed to validate password policy.');
    }
    if (policyData?.error) {
      throw new Error(policyData.error);
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) throw error;
    return data;
  };

  const signIn = async (email: string, password: string) => {
    console.log("🔐 signIn:", email);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    console.log("🛬 signIn result:", data, error);
    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    try {
      await notificationService.cancelAllNotifications?.();
    } catch (err) {
      console.log("⚠️ Notification cleanup skipped:", (err as Error)?.message || err);
    }

    if (error) throw error;
  };

  return (
    <AuthContext.Provider value={{ session, user, loading, signUp, signIn, signOut }}>
      {loading ? (
        Platform.OS === 'web' ? (
          <div style={{ textAlign: 'center', marginTop: 50 }}>Loading…</div>
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={{ marginTop: 10 }}>Loading…</Text>
          </View>
        )
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const c = useContext(AuthContext);
  if (c === undefined) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return c;
};
