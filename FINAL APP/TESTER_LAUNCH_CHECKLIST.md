# GLP Buddy Tester Launch Checklist

## 1. Supabase setup
- Create the Supabase project
- Run migrations 001 to 005 in order
- Create/deploy Edge Functions
- Add secrets:
  - SUPABASE_URL
  - SUPABASE_ANON_KEY
  - SUPABASE_SERVICE_ROLE_KEY
  - ADMIN_EMAIL_ALLOWLIST
- Paste URL and anon key into `glp-supabase-config.js`

## 2. Smoke test the user journey
- Sign up
- Log in
- Complete onboarding
- Confirm selected theme persists into Home
- Save weight
- Save check-in
- Save symptoms
- Upload progress photo
- Generate meal plan
- Start and complete workout
- Confirm next day shows Rest day
- Refresh and confirm data still exists

## 3. Admin checks
- Open `admin-stats.html`
- Confirm summary loads
- Confirm CSV exports download
- Confirm events are appearing after app actions

## 4. Visual QA
- Test all skins
- Check text contrast on every main screen
- Check top bar and bottom nav colors align
- Check buttons work on Sand and Midnight
- Check photo gallery spacing above bottom nav

## 5. Legal pages
- Make `privacy.html`, `terms.html`, `disclaimer.html`, and `tester-consent.html` accessible from onboarding/auth or a simple footer/menu

## 6. First tester rollout
- Start with 3 to 5 trusted testers
- Ask them to use the app for one full week
- Collect direct feedback plus exported usage data
- Patch issues before opening testing wider
