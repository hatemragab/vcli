# FCM messaging setup and device acceptance

Select FCM independently of Firebase identity. A local JWT app can use it. `FCM_PROJECT_ID` identifies the messaging project; `FCM_CREDENTIALS_PATH` optionally names a private, regular, non-symlink service-account JSON file <=64 KiB with matching project. Without that path the separately named messaging app uses ADC. Never fall back to Firebase identity's credential file or put a JSON key in `.env.example`. ADC is shared platform infrastructure only when the operator explicitly chooses it.

Enable Firebase Cloud Messaging API and least-privilege messaging access in the intended project. Android: register the correct application ID/config, request notification permission on supported OS versions and create the intended notification channel. iOS: configure APNs credentials in Firebase, matching bundle ID, Push Notifications entitlement and notification authorization. Web: configure HTTPS, service worker and browser VAPID public key and explicit user permission. Those platform credentials are external; generating this checklist does not provision them.

Obtain the current registration token from the platform SDK. Keep it private and call `pushClient.register({purpose:'ordinary',platform,token})` after authentication and every SDK token refresh. Never print tokens in terminal output. Re-register after account switch, logout/login or installation possession rotation. FCM ordinary and APNs PushKit VoIP tokens are separate destinations; never register a PushKit token as ordinary FCM.

Record provider acceptance separately from actual foreground/background/terminated app behavior, permission denial, expiry, token rotation and logout/rebind isolation. Exercise an Android and iOS device in the intended project/environment. The backend uses a bounded per-token Admin SDK send and normalizes explicit invalid-token, payload, credentials, transient, throttle and unknown outcomes; it never infers that invalid-argument alone authorizes deletion.

Official setup: https://firebase.google.com/docs/cloud-messaging/server-environment and https://firebase.google.com/docs/cloud-messaging/error-codes .
