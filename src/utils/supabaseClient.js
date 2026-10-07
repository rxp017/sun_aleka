import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(url && publishableKey);

export const supabase = isSupabaseConfigured
  ? createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
      global: {
        headers: { 'x-application-name': 'sun_aleka' },
      },
    })
  : null;

export async function cacheCalculation(userId, mode, payload, result) {
  if (!supabase || !userId) return { cached: false };

  const { error } = await supabase.from('solar_calculations').insert({
    user_id: userId,
    mode,
    request_payload: payload,
    result_payload: result,
  });

  if (error) throw error;
  return { cached: true };
}
