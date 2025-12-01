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

      // ✅ Handle token refresh to maintain session
      if (event === "TOKEN_REFRESHED" && sess) {
        console.log("✅ Token refreshed, session maintained");
        if (!cancelled) {
          setSession(sess);
          setUser(sess?.user ?? null);
        }
      }

      // ✅ Handle signed out event
      if (event === "SIGNED_OUT") {
        console.log("👋 User signed out");
        if (!cancelled) {
          setSession(null);
          setUser(null);
        }
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
              .eq("id", user.id)
              .maybeSingle();
            if (pErr && pErr.code !== 'PGRST116') throw pErr;
            if (!p) {
              const { error: insErr } = await supabase.from("profiles").insert({
                id: user.id,
                email: user.email!,
                full_name: user.user_metadata?.full_name,
              });
              // Ignore duplicate key errors (profile already exists from signIn)
              if (insErr && insErr.code !== '23505') {
                console.error("⚠️ Profile creation error:", insErr);
              } else if (!insErr) {
                console.log("✅ Profile created in onAuthStateChange");
              }
            }
          } catch (e: any) {
            // Ignore duplicate key errors
            if (e?.code !== '23505') {
              console.error("⚠️ Profile creation error:", e);
            }
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

  // ✅ Periodic session refresh to maintain login
  useEffect(() => {
    if (!session) return;

    const refreshInterval = setInterval(async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.warn("⚠️ Session refresh check error:", error.message);
          // Don't sign out on refresh errors - let autoRefreshToken handle it
          return;
        }
        if (data?.session) {
          setSession(data.session);
          setUser(data.session.user);
        }
      } catch (err) {
        console.error("❌ Session refresh check exception:", err);
      }
    }, 5 * 60 * 1000); // Check every 5 minutes

    return () => clearInterval(refreshInterval);
  }, [session]);

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

    // 🔍 DEBUG LOGGING - Full response details
    console.log('🔍 [SIGNUP DEBUG] Password Policy Function Response:');
    console.log('  - policyData:', JSON.stringify(policyData, null, 2));
    console.log('  - policyError:', JSON.stringify(policyError, null, 2));
    console.log('  - policyError type:', typeof policyError);
    console.log('  - policyError message:', (policyError as any)?.message);
    console.log('  - policyError error:', (policyError as any)?.error);
    if (policyError) {
      console.log('  - Full policyError object:', policyError);
    }

    // Handle edge function response - check data.error first (from response body), then policyError (HTTP error)
    if (policyData?.error) {
      // Response body contains an error message
      console.log('❌ [SIGNUP DEBUG] Error in policyData:', policyData.error);
      throw new Error(policyData.error);
    }

    // Check for HTTP-level errors (non-2xx status codes)
    if (policyError) {
      // Try to extract error message from policyError or use policyData if available
      const errorMessage = (policyError as any)?.message || 
                          (policyError as any)?.error?.message ||
                          policyData?.error ||
                          'Failed to validate password policy.';
      console.log('❌ [SIGNUP DEBUG] HTTP Error from edge function:', errorMessage);
      throw new Error(errorMessage);
    }

    // Require explicit success flag
    if (!policyData || policyData.valid !== true) {
      console.log('❌ [SIGNUP DEBUG] Missing valid flag. policyData:', policyData);
      throw new Error('Password validation failed.');
    }

    console.log('✅ [SIGNUP DEBUG] Password policy validation passed');

    // Call supabase.auth.signUp with correct parameters
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });

    // Only throw if there's an actual error from Supabase
    if (error) {
      throw error;
    }

    // Treat signup as successful if user was created, even if session is null
    // (This is normal for email confirmation flows)
    if (!data.user) {
      throw new Error('Failed to create user account. Please try again.');
    }

    // Return data - user exists, session may be null if email confirmation is required
    return data;
  };

  const signIn = async (email: string, password: string) => {
    console.log("🔐 signIn:", email);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    console.log("🛬 signIn result:", data, error);
    
    if (error) {
      // Check for specific error cases
      const errorMessage = error.message?.toLowerCase() || '';
      const errorCode = error.status || error.code;
      
      // Deleted account or invalid credentials - Supabase returns same error for both
      // We'll throw a specific error that the UI can handle
      if (errorMessage.includes('invalid login credentials') || 
          errorMessage.includes('invalid credentials') ||
          errorCode === 400) {
        // This could be wrong password OR deleted account
        // The UI will show a message covering both cases
        const customError: any = new Error('INVALID_CREDENTIALS_OR_DELETED');
        customError.originalError = error;
        throw customError;
      }
      
      // Email not confirmed
      if (errorMessage.includes('email not confirmed')) {
        throw error;
      }
      
      // Other errors
      throw error;
    }
    
    // After successful sign-in, check if profile exists (for unregistered user detection)
    if (data?.user) {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', data.user.id)
        .maybeSingle();
      
      if (profileError || !profileData) {
        // Profile doesn't exist - try to create it (for newly verified users)
        console.log('⚠️ Profile not found, attempting to create profile for user:', data.user.id);
        
        try {
          // Check if this is a newly verified user (has full_name in metadata from signup)
          const fullName = data.user.user_metadata?.full_name;
          
          if (fullName) {
            // This is a verified user from signup - create their profile
            const { error: createError } = await supabase.from('profiles').insert({
              id: data.user.id,
              email: data.user.email!,
              full_name: fullName,
            });
            
            if (createError) {
              // Check if it's a duplicate key error (profile already exists)
              if (createError.code === '23505') {
                console.log('ℹ️ Profile already exists (created by another process)');
                // Profile exists - continue normally
              } else {
                console.error('❌ Failed to create profile:', createError);
                // If profile creation fails, check if it was created by another process
                // Wait a bit and check again
                await new Promise(resolve => setTimeout(resolve, 500));
                const { data: retryProfileData } = await supabase
                  .from('profiles')
                  .select('id')
                  .eq('id', data.user.id)
                  .maybeSingle();
                
                if (!retryProfileData) {
                  // Still no profile - this is truly an unregistered user
                  console.warn('⚠️ User authenticated but profile not found after creation attempt - unregistered user');
                  await supabase.auth.signOut();
                  const customError: any = new Error('UNREGISTERED_USER');
                  customError.userId = data.user.id;
                  throw customError;
                }
                // Profile was created by another process - continue
                console.log('✅ Profile found after retry');
              }
            } else {
              console.log('✅ Profile created successfully for verified user');
            }
          } else {
            // No full_name in metadata - this is likely an unregistered user
            console.warn('⚠️ User authenticated but profile not found and no signup metadata - unregistered user');
            await supabase.auth.signOut();
            const customError: any = new Error('UNREGISTERED_USER');
            customError.userId = data.user.id;
            throw customError;
          }
        } catch (error: any) {
          // If it's already an UNREGISTERED_USER error, rethrow it
          if (error.message === 'UNREGISTERED_USER') {
            throw error;
          }
          // Other errors - treat as unregistered
          console.error('❌ Error handling missing profile:', error);
          await supabase.auth.signOut();
          const customError: any = new Error('UNREGISTERED_USER');
          customError.userId = data.user.id;
          throw customError;
        }
      }
    }
    
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
