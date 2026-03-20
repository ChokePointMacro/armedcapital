import { createServerSupabase } from './supabase';

// Supabase data access layer - replaces SQLite queries from server.ts
const db = createServerSupabase();

// ==================== USERS ====================
export async function getUserByClerkId(clerkId: string) {
  const { data } = await db.from('users').select('*').eq('id', clerkId).single();
  return data;
}

export async function getUserByXId(xId: string) {
  const { data } = await db.from('users').select('*').eq('x_id', xId).single();
  return data;
}

export async function upsertUser(user: {
  id: string; x_id?: string; email?: string; username?: string;
  display_name?: string; profile_image?: string;
  access_token?: string; refresh_token?: string; expires_at?: number;
}) {
  const { data, error } = await db.from('users').upsert(user, { onConflict: 'id' }).select().single();
  if (error) throw error;
  return data;
}

// ==================== REPORTS ====================
export async function getReports(limit = 50) {
  const { data } = await db.from('reports').select('*').order('updated_at', { ascending: false }).limit(limit);
  return data || [];
}

export async function getAutoReports(limit = 50) {
  const { data } = await db.from('reports').select('*').eq('auto_generated', true).order('updated_at', { ascending: false }).limit(limit);
  return data || [];
}

export async function saveReport(report: { id: string; type: string; content: any; custom_topic?: string; auto_generated?: boolean }) {
  const { data, error } = await db.from('reports').upsert({
    ...report,
    content: typeof report.content === 'string' ? report.content : JSON.stringify(report.content),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteReport(id: string) {
  await db.from('reports').delete().eq('id', id);
}

export async function deleteAllReports() {
  await db.from('reports').delete().neq('id', '');
}

// ==================== SCHEDULED POSTS ====================
export async function getScheduledPosts(userId: string) {
  const { data } = await db.from('scheduled_posts').select('*').eq('user_id', userId).order('scheduled_at', { ascending: true });
  return data || [];
}

export async function createScheduledPost(post: { user_id: string; content: string; scheduled_at: string }) {
  const { data, error } = await db.from('scheduled_posts').insert(post).select().single();
  if (error) throw error;
  return data;
}

export async function deleteScheduledPost(id: number) {
  await db.from('scheduled_posts').delete().eq('id', id);
}

export async function getPendingScheduledPosts() {
  const { data } = await db.from('scheduled_posts')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString());
  return data || [];
}

export async function updateScheduledPostStatus(id: number, status: string) {
  await db.from('scheduled_posts').update({ status }).eq('id', id);
}

// ==================== SCHEDULED REPORTS ====================
export async function getScheduledReports() {
  const { data } = await db.from('scheduled_reports').select('*').order('id', { ascending: true });
  return data || [];
}

export async function createScheduledReport(report: { report_type: string; custom_topic?: string; schedule_time: string; days: string }) {
  const { data, error } = await db.from('scheduled_reports').insert(report).select().single();
  if (error) throw error;
  return data;
}

export async function updateScheduledReport(id: number, updates: Partial<{ report_type: string; custom_topic: string; schedule_time: string; days: string; enabled: boolean; last_run: string }>) {
  const { error } = await db.from('scheduled_reports').update(updates).eq('id', id);
  if (error) throw error;
}

export async function deleteScheduledReport(id: number) {
  await db.from('scheduled_reports').delete().eq('id', id);
}

// ==================== PLATFORM TOKENS ====================
export async function getPlatformToken(userId: string, platform: string) {
  const { data } = await db.from('platform_tokens').select('*').eq('user_id', userId).eq('platform', platform).single();
  return data;
}

export async function getAllPlatformTokens(userId: string) {
  const { data } = await db.from('platform_tokens').select('*').eq('user_id', userId);
  return data || [];
}

export async function upsertPlatformToken(token: {
  user_id: string; platform: string; access_token: string;
  refresh_token?: string; handle?: string; person_urn?: string; expires_at?: number;
}) {
  const { error } = await db.from('platform_tokens').upsert({
    ...token,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,platform' });
  if (error) throw error;
}

export async function deletePlatformToken(userId: string, platform: string) {
  await db.from('platform_tokens').delete().eq('user_id', userId).eq('platform', platform);
}

// ==================== PLATFORM CREDENTIALS ====================
export async function getPlatformCredentials() {
  const { data } = await db.from('platform_credentials').select('*');
  return data || [];
}

export async function getPlatformCredential(platform: string, keyName: string) {
  const { data } = await db.from('platform_credentials').select('*').eq('platform', platform).eq('key_name', keyName).single();
  return data;
}

export async function upsertPlatformCredential(cred: { platform: string; key_name: string; key_value: string }) {
  const { error } = await db.from('platform_credentials').upsert({
    ...cred,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'platform,key_name' });
  if (error) throw error;
}

export async function deletePlatformCredentials(platform: string) {
  await db.from('platform_credentials').delete().eq('platform', platform);
}

// ==================== WATCHLIST ====================
export async function getWatchlist(userId: string) {
  const { data } = await db.from('watchlist').select('*').eq('user_id', userId).order('added_at', { ascending: false });
  return data || [];
}

export async function addToWatchlist(item: { user_id: string; symbol: string; name?: string; type?: string }) {
  const { error } = await db.from('watchlist').upsert(item, { onConflict: 'user_id,symbol' });
  if (error) throw error;
}

export async function removeFromWatchlist(userId: string, symbol: string) {
  await db.from('watchlist').delete().eq('user_id', userId).eq('symbol', symbol);
}

// ==================== APP SETTINGS ====================
export async function getAppSetting(key: string) {
  const { data } = await db.from('app_settings').select('value').eq('key', key).single();
  return data?.value || null;
}

export async function setAppSetting(key: string, value: string) {
  const { error } = await db.from('app_settings').upsert({
    key,
    value,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
  if (error) throw error;
}

// ==================== CONTEXT FILES ====================
export async function getContextFiles() {
  const { data } = await db.from('context_files').select('name, created_at, updated_at').order('name');
  return data || [];
}

export async function getContextFile(name: string) {
  const { data } = await db.from('context_files').select('*').eq('name', name).single();
  return data;
}

export async function upsertContextFile(name: string, content: string) {
  const { error } = await db.from('context_files').upsert({
    name,
    content,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'name' });
  if (error) throw error;
}

export async function deleteContextFile(name: string) {
  await db.from('context_files').delete().eq('name', name);
}

// ==================== PENDING AUTH ====================
export async function createPendingAuth(state: string, codeVerifier: string, platform = 'x') {
  const { error } = await db.from('pending_auth').insert({ state, code_verifier: codeVerifier, platform });
  if (error) throw error;
}

export async function getPendingAuth(state: string) {
  const { data } = await db.from('pending_auth').select('*').eq('state', state).single();
  return data;
}

export async function deletePendingAuth(state: string) {
  await db.from('pending_auth').delete().eq('state', state);
}

export async function cleanupOldPendingAuth() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await db.from('pending_auth').delete().lt('created_at', oneHourAgo);
}
