const THEME_CLASSES = ['theme-rose','theme-sage','theme-sand','theme-midnight'];

function stripThemePrefix(theme){
  return (theme || 'sage').replace(/^theme-/, '');
}
function addThemePrefix(theme){
  return theme && theme.startsWith('theme-') ? theme : `theme-${theme || 'sage'}`;
}
function safeParse(v, fallback){ try { return JSON.parse(v); } catch { return fallback; } }
function todayKey(){ return new Date().toISOString().slice(0,10); }
function mapTheme(theme){ return stripThemePrefix(theme || 'sage'); }
function sexToLegacy(sex){ return sex === 'female' ? 'F' : sex === 'male' ? 'M' : ''; }
function sexFromLegacy(sex){ return sex === 'F' ? 'female' : sex === 'M' ? 'male' : (sex || null); }
function profileUnitsToLegacy(units){ return units === 'imperial' ? 'lbs' : 'kg'; }
function legacyUnitsToProfile(units){ return units === 'lbs' ? 'imperial' : 'metric'; }

window.GLPCloudReady = (async () => {
  const config = window.GLP_SUPABASE_CONFIG || {};
  const enabled = !!(config.url && config.anonKey);
  const cloud = {
    enabled,
    api: null,
    client: null,
    supabase: null,
    applyTheme(theme){
      const cssTheme = addThemePrefix(theme);
      THEME_CLASSES.forEach(c => document.body.classList.remove(c));
      document.body.classList.add(cssTheme);
      return cssTheme;
    },
    compatibility: {
      writeSettingsCache({ profile, settings, onboarding, extras = {} } = {}) {
        const prev = safeParse(localStorage.getItem('glp_settings'), {}) || {};
        const weightTarget = onboarding?.target_weight_kg ?? prev.goalWeight ?? null;
        const installDate = profile?.install_date || prev.startDate || todayKey();
        const skin = addThemePrefix(settings?.theme || profile?.current_theme || prev.skin || 'theme-sage');
        const merged = {
          ...prev,
          ...extras,
          name: profile?.display_name || prev.name || 'Friend',
          gender: sexToLegacy(profile?.sex) || prev.gender || 'M',
          units: profileUnitsToLegacy(profile?.units || 'metric'),
          startDate: installDate,
          goalWeight: weightTarget,
          curWeight: prev.curWeight ?? onboarding?.current_weight_kg ?? null,
          skin,
          waterSize: String(settings?.water_glass_ml || 200),
        };
        localStorage.setItem('glp_settings', JSON.stringify(merged));
        return merged;
      },
      writeOnboardingCache({ complete = true } = {}) {
        localStorage.setItem('glp_onboarding', JSON.stringify({ complete, completedAt: new Date().toISOString() }));
      },
      writeWeightLogCache(rows) {
        const mapped = (rows || []).map(r => ({
          date: (r.logged_at || '').slice(0,10),
          weight: Number(r.weight_kg),
          units: 'kg',
          source: r.source || 'manual'
        })).sort((a,b) => a.date.localeCompare(b.date));
        localStorage.setItem('glp_weight_log', JSON.stringify(mapped));
        return mapped;
      },
      writePhotosCache(rows) {
        localStorage.setItem('glp_photos', JSON.stringify(rows || []));
      }
    }
  };

  if (!enabled) {
    console.warn('GLPCloud running in local mode. Fill in glp-supabase-config.js to enable Supabase.');
    window.GLPCloud = cloud;
    return cloud;
  }

const [clientMod, apiMod] = await Promise.all([
    import('./glp-supabase-client.js'),
    import('./glp-tier1-api.js')
  ]);

  cloud.client = clientMod;
  cloud.api = apiMod;
  cloud.supabase = clientMod.supabase;

  cloud.getSession = () => clientMod.getSession();
  cloud.getUser = () => clientMod.getUser();
  cloud.requireSession = (redirectTo='auth.html') => clientMod.requireSession(redirectTo);
  cloud.signOut = () => clientMod.signOut();

  cloud.getProfile = async () => {
    const user = await clientMod.getUser();
    if (!user) return null;
    const { data, error } = await clientMod.supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) throw error;
    return data;
  };
  cloud.updateProfile = async (patch) => {
    const user = await clientMod.getUser();
    if (!user) throw new Error('No authenticated user');
    const payload = { id: user.id, ...patch };
    const { error } = await clientMod.supabase.from('profiles').upsert(payload);
    if (error) throw error;
    return payload;
  };
  cloud.getOnboarding = async () => {
    const user = await clientMod.getUser();
    if (!user) return null;
    const { data, error } = await clientMod.supabase.from('onboarding_responses').select('*').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return data;
  };
  cloud.getUserSettings = async () => {
    const user = await clientMod.getUser();
    if (!user) return null;
    const { data, error } = await clientMod.supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return data;
  };
  cloud.getWeightLogs = async () => {
    const { data, error } = await clientMod.supabase.from('weight_logs').select('*').order('logged_at', { ascending: true });
    if (error) throw error;
    return data || [];
  };
  cloud.getLatestWeightLog = async () => {
    const { data, error } = await clientMod.supabase.from('weight_logs').select('*').order('logged_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data;
  };
  cloud.getTodayCheckin = async (date = todayKey()) => {
    const { data, error } = await clientMod.supabase.from('daily_checkins').select('*').eq('checkin_date', date).maybeSingle();
    if (error) throw error;
    return data;
  };
  cloud.getSymptomsByDate = async (date = todayKey()) => {
    const { data, error } = await clientMod.supabase.from('symptom_entries').select('*').eq('entry_date', date).order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  };
  cloud.getLatestHydration = async () => {
    const { data, error } = await clientMod.supabase.from('hydration_logs').select('*').order('logged_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data;
  };
  cloud.listProgressPhotos = apiMod.listProgressPhotos;
  cloud.createSignedProgressPhotoUrl = apiMod.createSignedProgressPhotoUrl;
  cloud.uploadProgressPhoto = apiMod.uploadProgressPhoto;
  cloud.softDeleteProgressPhoto = async (photoId) => {
    const { error } = await clientMod.supabase.from('progress_photos').update({ is_deleted: true }).eq('id', photoId);
    if (error) throw error;
  };
  cloud.saveSettings = async (patch) => {
    await apiMod.saveSettings(patch);
    if (patch.theme) await cloud.updateProfile({ current_theme: stripThemePrefix(patch.theme) });
  };
  cloud.completeOnboarding = async (payload, extras = {}) => {
    await apiMod.completeOnboarding(payload);
    const profilePatch = {
      display_name: payload.displayName ?? null,
      sex: payload.sex ?? null,
      height_cm: payload.heightCm ?? null,
      current_theme: stripThemePrefix(payload.theme || 'sage'),
      units: legacyUnitsToProfile(extras.units || 'kg'),
    };
    await cloud.updateProfile(profilePatch);
    cloud.compatibility.writeSettingsCache({
      profile: { ...profilePatch, install_date: todayKey(), display_name: payload.displayName, sex: payload.sex, units: legacyUnitsToProfile(extras.units || 'kg') },
      settings: { theme: stripThemePrefix(payload.theme || 'sage'), water_glass_ml: 200 },
      onboarding: { current_weight_kg: payload.currentWeightKg, target_weight_kg: payload.targetWeightKg },
      extras: {
        medName: extras.medName || '',
        medOther: extras.medOther || '',
        medDose: extras.medDose || '',
        medFreq: extras.medFreq || 'weekly',
        medDay: extras.medDay || 'Mon',
        notifMeds: true,
        notifWater: true,
        notifWorkout: true,
        notifPhoto: true,
      }
    });
    cloud.compatibility.writeOnboardingCache({ complete: true });
  };
  cloud.saveWeight = apiMod.saveWeight;
  cloud.saveDailyCheckin = apiMod.saveDailyCheckin;
  cloud.replaceSymptoms = apiMod.replaceSymptoms;
  cloud.saveHydration = apiMod.saveHydration;
  cloud.saveMealPreferences = apiMod.saveMealPreferences;
  cloud.getMealPreferences = apiMod.getMealPreferences;
  cloud.saveGeneratedMealPlan = apiMod.saveGeneratedMealPlan;
  cloud.getLatestMealPlan = apiMod.getLatestMealPlan;
  cloud.startWorkoutSession = apiMod.startWorkoutSession;
  cloud.completeWorkoutSession = apiMod.completeWorkoutSession;
  cloud.addWorkoutSet = apiMod.addWorkoutSet;
  cloud.getRestDayStatus = apiMod.getRestDayStatus;
  cloud.getWorkoutHistory = apiMod.getWorkoutHistory;
  cloud.submitFeedback = apiMod.submitFeedback;

  cloud.getProgressPhotosWithUrls = async () => {
    const rows = await apiMod.listProgressPhotos();
    const mapped = await Promise.all(rows.map(async row => ({
      ...row,
      signedUrl: await apiMod.createSignedProgressPhotoUrl(row.storage_path)
    })));
    return mapped;
  };

  cloud.syncSettingsToCompatibility = async (extras = {}) => {
    const [profile, settings, onboarding] = await Promise.all([
      cloud.getProfile(),
      cloud.getUserSettings(),
      cloud.getOnboarding()
    ]);
    const merged = cloud.compatibility.writeSettingsCache({ profile, settings, onboarding, extras });
    return { profile, settings, onboarding, merged };
  };

  cloud.bootPrivatePage = async ({ pageName = (location.pathname.split('/').pop() || 'index.html'), requireOnboarding = true, redirectTo = 'auth.html' } = {}) => {
    const session = await clientMod.requireSession(redirectTo);
    if (!session) return null;
    await apiMod.startAppSession({ platform: 'web', appVersion: 'tier1-bridge' });
    const [profile, settings, onboarding] = await Promise.all([
      cloud.getProfile(),
      cloud.getUserSettings(),
      cloud.getOnboarding()
    ]);
    const onboardingComplete = !!(profile?.onboarding_complete || onboarding?.completed_at);
    if (requireOnboarding && !onboardingComplete && !/onboarding\.html$/i.test(pageName)) {
      location.href = 'onboarding.html?next=' + encodeURIComponent(pageName);
      return null;
    }
    cloud.applyTheme(settings?.theme || profile?.current_theme || 'sage');
    try { await apiMod.logEvent('page_view', { page: pageName }, pageName); } catch (err) { console.warn(err); }
    return { session, profile, settings, onboarding, enabled: true };
  };

  window.GLPCloud = cloud;
  return cloud;
})();
