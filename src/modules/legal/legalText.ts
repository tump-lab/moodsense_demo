/**
 * Terms of Service and Privacy Policy; keep them in step with the streams in ../consent/streams.ts and the storage text in ../consent/consentText.ts.
 * Contact details are filled in; update the Last updated date whenever either text changes.
 */

export const TERMS_OF_SERVICE_TEXT = `MoodSense Terms of Service

1. What this is. MoodSense is a wellbeing app built to help you understand how your days, your body, and your mood connect. It is not a medical device. It is operated by TUMP Lab.

2. Eligibility and your account. You must be at least 18 years old to create an account. You are responsible for the accuracy of the information you provide, for keeping your account credentials confidential, and for all activity under your account. One account per person. You may sign in with an email and password or with a Google account.

3. Not medical advice. MoodSense is a wellbeing tool. It does not diagnose, treat, or provide medical or mental-health advice, and nothing in the app is a substitute for professional care. If you are in crisis or need immediate help, contact local emergency services or a crisis line in your area.

4. What the app does. MoodSense asks you to self-report mood and complete periodic wellbeing check-ins (including a short Patient Health Questionnaire-4), offers optional guided activities and peer group chat rooms with an AI guide, and — separately, and only with your explicit consent — collects passive sensing data from your device. The sensing streams, what each one covers, and how to turn any of them off are described in full in the Privacy Policy and in the consent text.

5. Community features. Community screens show only aggregated statistics from other people in your chosen community, shown as counts of how many people logged each mood (a count may be as small as 1). You never see another individual's data.

6. Your content. Anything you type into check-ins, questionnaires, or group chat rooms is yours, but by agreeing to the data & privacy notice you grant TUMP Lab the right to store and process it to run the app for you, as described in the Privacy Policy and the data & privacy notice.

7. Acceptable use. Do not use MoodSense to impersonate someone else, to interfere with the app or its infrastructure, to attempt to re-identify other people from aggregate data, or to submit data on behalf of anyone but yourself.

8. Data and account deletion. You may stop using the app, turn off any sensing stream in Settings, or delete your data at any time, as described in the Privacy Policy. Contact tumplab2026@gmail.com to request account deletion.

9. Disclaimers and limitation of liability. MoodSense is provided "as is," without warranties of any kind, to the extent permitted by applicable law. To the fullest extent permitted by the State of California, TUMP Lab is not liable for indirect, incidental, or consequential damages arising from your use of the app.

10. Changes to these Terms. We may update these Terms as the app evolves. Material changes will be reflected here with an updated date, and continued use of the app after a change means you accept the updated Terms.

11. Governing law. These Terms are governed by the laws of the State of California, without regard to its conflict-of-laws principles.

12. Contact. Questions about these Terms can be sent to tumplab2026@gmail.com.

Last updated: November 15, 2026`;

export const PRIVACY_POLICY_TEXT = `MoodSense Privacy Policy

This Privacy Policy explains what MoodSense collects, why, and what happens to it. It is meant to be read alongside the MoodSense Data & Privacy Notice you agree to when creating an account; where the two differ, ask tumplab2026@gmail.com.

Who runs this. MoodSense is operated by TUMP Lab.

What we collect.
• Account information: the email address (or Google account identifier) you sign in with.
• Self-reported data: your mood check-ins, Patient Health Questionnaire-4 answers, and any messages you send in group chat rooms.
• Passive sensing data, only for the streams you have turned on in Settings (every stream defaults to on):
  – Motion & activity: accelerometer-derived motion, step counts, activity type.
  – Screen & usage: screen on/off events, unlock frequency, and aggregate app-usage statistics (screen time, top apps, unlock counts) — never a per-second timeline of what you did in each app.
  – Health data: heart rate, resting heart rate, breathing rate, blood oxygen, step counts, workouts, and mindful minutes, read only from your phone's native health platform (Apple HealthKit or Android Health Connect), with each sample's timestamp and recording source (e.g., your watch).
  – Sleep: sleep stages and durations from your health platform, plus — when sleep and screen data are both on — an estimated nightly sleep window derived from overnight gaps in phone use, always labeled as an estimate.
  – Call length: how long your calls last — never who you called, a phone number, a contact name, or any audio.
Passive collection can happen periodically in the background while the app is not open, under the same consent settings.

How it is stored. Everything is stored on your device first, in an encrypted local database. If cloud sync is enabled for your account, the same data is uploaded to MoodSense's secure cloud database (built on Google Firebase), linked to a random device identifier — not your name. TUMP Lab can see data associated with that random identifier, not a name, unless you separately provide identifying information (e.g., in a group chat room).

No advertising, no sale. We do not use your data — including health data — for advertising or marketing, and we do not sell it to anyone, ever.

Community aggregates. Community screens show only per-mood counts for your chosen community (a count may be as small as 1), never another individual's data.

Your choices. You can:
• Turn any sensing stream on or off at any time in Settings — changes take effect immediately.
• Pause sensing entirely by turning off every stream.
• Delete your data at any time from Settings. Deleting removes your remote (cloud-synced) data; removing the app from your device deletes what is stored locally.
• Ask what data is held about you, or request a copy of it, by contacting tumplab2026@gmail.com.
To exercise any of these, contact tumplab2026@gmail.com.

Data retention. Your data is retained for as long as you have an account, until you delete it. Deleting your data removes it from our servers.

Children's privacy. MoodSense is not directed at children under 18 and does not knowingly collect data from them.

Changes to this policy. We may update this Privacy Policy as the app evolves. Material changes will be reflected here with an updated date.

Contact. Questions or concerns about this policy can be sent to tumplab2026@gmail.com.

Last updated: November 15, 2026`;
