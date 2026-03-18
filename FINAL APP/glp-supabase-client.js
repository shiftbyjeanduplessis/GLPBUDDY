// Import the Supabase library directly from a CDN
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const config = window.GLP_SUPABASE_CONFIG;

if (!config || !config.url || !config.anonKey) {
    console.error('Missing Supabase config. Ensure glp-supabase-config.js is loaded.');
}

// Initialize the connection
export const supabase = createClient(config.url, config.anonKey);

export async function signUp(email, password) {
    return await supabase.auth.signUp({ email, password });
}

export async function signIn(email, password) {
    return await supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
    return await supabase.auth.signOut();
}

export async function getSession() {
    return await supabase.auth.getSession();
}

export async function getUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

export async function requireSession(redirectTo = 'auth.html') {
    const { data: { session } } = await getSession();
    if (!session) {
        window.location.href = redirectTo;
        return null;
    }
    return session;
}

export async function requestPasswordReset(email) {
    return await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/auth.html',
    });
}

export async function getAuthHeader() {
    const { data: { session } } = await getSession();
    if (!session) return null;
    return `Bearer ${session.access_token}`;
}

export function getFunctionsBaseUrl() {
    return `${config.url}/functions/v1`;
}
