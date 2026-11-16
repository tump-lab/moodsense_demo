/**
 * What the Help section offers: a per-region catalog of support, and the on-device ranking that
 * orders "Find resources" by the latest check-in mood.
 *
 * Numbers here come from each service's own or a government source; anything only a third-party
 * directory could confirm is a link rather than a number, and a region with no verified entry
 * gets a directory instead of a guess. Same rule as phq4/supportResources.ts.
 *
 * Crisis support is deliberately outside the ranking: it is the same whatever the mood, because
 * someone who tapped "Good" an hour ago may not feel good now.
 *
 * No React Native imports, so scripts/selfcheck-help.ts can run all of it under plain Node. The
 * mood never leaves the device: ranking is a local table lookup plus keyword matching.
 */
import type { Mood } from '../../services/db';
import { findCommunity } from './communities';
import SIMILARITY from './resourceSimilarity.json';

export type HelpRegion = 'US' | 'SG' | 'OTHER';

/** One thing an organization offers, listed inside the app with a link to its own page. */
export interface ResourceItem {
  id: string;
  title: string;
  /** One line, as the organization describes it. */
  blurb: string;
  /** What the item's own page says about it, in a sentence or two. */
  details?: string;
  audience?: string;
  location?: string;
  serviceType?: string;
  phone?: string;
  sms?: string;
  url: string;
}

export interface HelpResource {
  id: string;
  title: string;
  blurb: string;
  url?: string;
  phone?: string;
  sms?: string;
  /** What a Find Resources tile shows; `title` and `blurb` stay as the spoken label and the ranking text. */
  tile?: { name: string; line: string };
  /** Key into RESOURCE_LOGOS. */
  logo?: string;
  /** Find Resources: what the organization offers. A tile with items opens a list of them in the app. */
  items?: ResourceItem[];
  /** Terms matched against MOOD_PROFILES[mood].keywords. */
  keywords?: string[];
}

/** A real, running group, as its organizer lists it. */
export interface PeerGroup {
  id: string;
  name: string;
  about: string;
  schedule: string;
  format: 'Online' | 'In Person' | 'In Person + Online';
  location?: string;
  /** Shown on the group's card when its organizer has no bundled logo. */
  emoji?: string;
  /** The same schedule in a form a calendar can use, in the organizer's time zone. */
  meets?: GroupMeeting;
}

export interface GroupMeeting {
  /** 0 is Sunday. */
  weekday: number;
  /** Which of the month's weekdays, such as [1, 3] for 1st and 3rd. Absent means every week. */
  weeks?: number[];
  start: { h: number; m: number };
  durationMin: number;
}

/** An organization whose staff the Talk page offers. Message and video are sample screens until a partner connects them. */
export interface TalkPartner {
  name: string;
  region: string;
  phone: string;
  url: string;
}

export interface HelpCatalog {
  /** Listed groups, browsable and joinable on the Peer Support Groups page. Empty where none are verified. */
  groups: PeerGroup[];
  groupsOrganizer?: {
    name: string;
    phone: string;
    url: string;
    timeZone: string;
    /** Key into RESOURCE_LOGOS; the group cards show it in place of each group's emoji. */
    logo?: string;
  };
  /** Other ways to find a group. */
  peer: HelpResource[];
  find: HelpResource[];
  /** Named "Talk to MHA" where Mental Health America operates, "Talk to someone" elsewhere. */
  talkTitle: string;
  talkPartner?: TalkPartner;
  talk: HelpResource[];
  crisis: HelpResource[];
}

const DIRECTORY: HelpResource = {
  id: 'findahelpline',
  title: 'Find A Helpline',
  blurb: 'A directory of free, confidential helplines in your country.',
  url: 'https://findahelpline.com',
  tile: { name: 'Find A Helpline', line: 'Helplines in your country' },
  logo: 'findahelpline',
  keywords: ['talk', 'someone', 'listen', 'support', 'helpline'],
};

export const HELP_CATALOG: Record<HelpRegion, HelpCatalog> = {
  US: {
    groups: [
      {
        id: 'anxiety-depression-bipolar',
        emoji: '\u{1F9E0}',
        name: 'Anxiety / Depression / Bipolar Disorder',
        about: 'Share experiences and support each other.',
        schedule: '1st and 3rd Wednesday, 6:00-7:30 pm',
        meets: { weekday: 3, weeks: [1, 3], start: { h: 18, m: 0 }, durationMin: 90 },
        format: 'Online',
      },
      {
        id: 'party-line',
        emoji: '\u{2615}',
        name: 'Party Line',
        about: 'A welcoming space to connect, for adults 18 and older.',
        schedule: 'Weekly, Tuesdays, 5:00 pm',
        meets: { weekday: 2, start: { h: 17, m: 0 }, durationMin: 60 },
        format: 'Online',
      },
      {
        id: 'party-line-2',
        emoji: '\u{2615}',
        name: 'Party Line 2.0',
        about: 'A welcoming space to connect, for adults 18 and older.',
        schedule: 'Weekly, Thursdays, 10:00-11:00 am',
        meets: { weekday: 4, start: { h: 10, m: 0 }, durationMin: 60 },
        format: 'In Person',
        location: '914 South St., Lafayette, Indiana',
      },
      {
        id: 'meridian-recovery-depression',
        emoji: '\u{1F331}',
        name: "Meridian's Recovery And Depression",
        about: 'Support for recovery and depression.',
        schedule: 'Weekly, Thursdays, 4:00-5:00 pm',
        meets: { weekday: 4, start: { h: 16, m: 0 }, durationMin: 60 },
        format: 'In Person',
        location: '914 South St., Lafayette, Indiana',
      },
      {
        id: 'survivors-of-suicide',
        emoji: '\u{1F56F}',
        name: 'Survivors Of Suicide',
        about: 'For loved ones left behind.',
        schedule: '3rd Monday, 7:00-8:30 pm',
        meets: { weekday: 1, weeks: [3], start: { h: 19, m: 0 }, durationMin: 90 },
        format: 'In Person + Online',
        location: '914 South St., Lafayette, Indiana',
      },
    ],
    groupsOrganizer: {
      name: 'Mental Health America Wabash Valley Region',
      logo: 'mha',
      phone: '7657421800',
      url: 'https://mhawv.org/support-groups/',
      timeZone: 'America/Indiana/Indianapolis',
    },
    peer: [
      {
        id: 'nami-groups',
        title: 'National Alliance On Mental Illness Support Groups',
        blurb: 'Free, peer-led groups for people living with a mental health condition.',
        url: 'https://www.nami.org/support-groups/',
      },
      {
        id: 'mha-affiliates',
        title: 'Find A Local Mental Health America Group',
        blurb: 'Local Mental Health America affiliates run support groups and referrals.',
        url: 'https://mhanational.org/affiliates/',
      },
      {
        id: 'mha-youth-peer',
        title: 'Youth Peer Support',
        blurb: 'Free, anonymous call and text lines led by peers, for young people.',
        url: 'https://mhanational.org/resources/youth-peer-support/',
      },
    ],
    // A tile per organization. Tapping one with `items` lists what it offers inside the app, each with a
    // link to its own page; checked against those pages on 2026-11-05.
    find: [
      {
        id: 'mhawv-programs',
        tile: { name: 'Wabash Valley', line: 'Local programs & support' },
        title: 'Mental Health America Wabash Valley Region',
        blurb: 'Peer navigators, support groups, youth programs and training, from the local Mental Health America in Lafayette, Indiana.',
        url: 'https://mhawv.org/',
        phone: '7657421800',
        logo: 'mha',
        keywords: ['support', 'community', 'talk', 'someone', 'learn', 'care'],
        items: [
          {
            id: 'mhawv-peer-navigator',
            title: "Let's Talk Peer Navigators",
            blurb: 'One-on-one support for navigating mental health and substance use services.',
            details: 'Certified peer support professionals help you set goals, understand insurance, schedule appointments and connect to local resources, in person or by phone.',
            audience: 'Adults 18+, including those looking for care for a child',
            location: 'Lafayette, Indiana',
            serviceType: 'Peer Support',
            phone: '7657421800',
            url: 'https://mhawv.org/peer-navigator/',
          },
          {
            id: 'mhawv-support-groups',
            title: 'Support Groups',
            blurb: 'A range of local support groups, with meeting times and locations.',
            location: 'Lafayette, Indiana and online',
            serviceType: 'Groups',
            url: 'https://mhawv.org/support-groups/',
          },
          {
            id: 'mhawv-veterans',
            title: 'Veteran Mental Health Resource Center',
            blurb: 'Crisis help, peer counseling, help with Veterans Affairs benefits, and finding a local provider.',
            details: 'Also points to the Indianapolis Vet Center, which offers confidential counseling at no cost to those who qualify.',
            audience: 'Veterans, active-duty service members and their families',
            location: 'Lafayette, Indiana',
            serviceType: 'Peer Support',
            url: 'https://mhawv.org/veterans/',
          },
          {
            id: 'mhawv-mst',
            title: 'Multisystemic Therapy',
            blurb: 'An intensive, family-based intervention for at-risk youth.',
            details: 'Families are referred to the program through the Department of Child Services.',
            audience: 'Families with at-risk youth',
            location: 'Lafayette, Indiana',
            serviceType: 'Therapy',
            url: 'https://mhawv.org/multisystemic-therapy/',
          },
          {
            id: 'mhawv-qpr',
            title: 'Question, Persuade, Refer Suicide Prevention Training',
            blurb: 'Question, Persuade, Refer: how to spot the warning signs of a suicide crisis and help.',
            details: 'Ask a school or youth group to schedule a training, or call the office with your county and they will set one up.',
            location: 'Lafayette, Indiana',
            serviceType: 'Training',
            phone: '7657421800',
            url: 'https://mhawv.org/youth/',
          },
          {
            id: 'mhawv-youth-council',
            title: 'Youth Advisory Council',
            blurb: 'Represent your peers and plan mental wellness work in your county.',
            details: 'Members meet monthly with fellow students and adult mentors. Apply as a member or as a mentor.',
            audience: 'Students, and adults who want to mentor',
            location: 'Lafayette, Indiana',
            serviceType: 'Youth',
            url: 'https://mhawv.org/youth/',
          },
          {
            id: 'mhawv-youth-toolkit',
            title: 'Youth Peer Support Toolkit',
            blurb: 'What youth peer support is, common questions, and why it matters.',
            audience: 'Teens and young adults',
            location: 'Online',
            serviceType: 'Download',
            url: 'https://mhawv.org/youth/',
          },
          {
            id: 'mhawv-training',
            title: 'Training & Education',
            blurb: 'Presentations, discussions and workshops on mental health topics.',
            audience: 'Community groups, workplaces and schools',
            location: 'Lafayette, Indiana',
            serviceType: 'Training',
            url: 'https://mhawv.org/training-and-education/',
          },
        ],
      },
      {
        id: 'mhawv-screening',
        tile: { name: 'Free Check-Up', line: 'Private online tests' },
        title: 'Free Mental Health Check-Up',
        blurb: 'Free, confidential online tests from Mental Health America. Afterwards you get information and tools based on your answers.',
        url: 'https://mhawv.org/mental-health-screening/',
        logo: 'mha',
        keywords: ['tools', 'self-help', 'understand', 'start', 'wellbeing'],
        items: [
          ['universal', 'Universal Mental Health Screening', 'Covers 12+ common conditions in 5-10 minutes.', undefined, 'https://screening.mhanational.org/screen-collection/universal-mental-health-screening/'],
          ['depression', 'Depression Test', 'For overwhelming sadness or despair, low energy, or a negative self-image.'],
          ['anxiety', 'Anxiety Test', 'For extreme worry or fear that affects day-to-day life.'],
          ['social-anxiety', 'Social Anxiety Test', 'For extreme worry or fear in social situations.'],
          ['adhd', 'Attention-Deficit/Hyperactivity Disorder Test', 'For trouble focusing, remembering, finishing tasks or sitting still.', 'All ages'],
          ['bipolar', 'Bipolar Test', 'For extreme mood swings or unusual shifts in mood and energy.'],
          ['ptsd', 'Post-Traumatic Stress Disorder Test', 'For ongoing distress after a traumatic event.'],
          ['ocd', 'Obsessive-Compulsive Disorder Test', 'For repetitive thoughts and behaviors that get in the way. Also tests for hoarding.'],
          ['eating-disorder', 'Eating Disorder Test', 'For an unhealthy relationship with food that affects your health.'],
          ['addiction', 'Addiction Test', 'For worries about alcohol, drugs, or behaviors like gambling.'],
          ['postpartum-depression', 'Postpartum Depression Test', 'For sadness that began during pregnancy or after birth.', 'New and expecting parents'],
          ['psychosis', 'Psychosis & Schizophrenia Test', 'For feeling that your brain is playing tricks on you.'],
          ['youth', 'Youth Mental Health Test', 'A check-in made for young people.', 'Ages 11-17'],
          ['parent', 'Parent Test: Your Child’s Mental Health', 'For parents worried about a child’s emotions, attention or behavior.', 'Parents'],
        ].map(([slug, title, blurb, audience, url]) => ({
          id: `mha-test-${slug}`,
          title: title!,
          blurb: blurb!,
          audience,
          location: 'Online',
          serviceType: 'Screening',
          url: url ?? `https://screening.mhanational.org/screening-tools/${slug}/`,
        })),
      },
      {
        id: 'purdue-caps',
        tile: { name: 'Purdue Counseling', line: 'For Purdue students' },
        title: 'Purdue Counseling And Psychological Services',
        blurb: 'Counseling and Psychological Services for Purdue students. Everything is free except psychiatry. 601 Stadium Mall Drive, Room 224.',
        url: 'https://www.purdue.edu/caps/',
        phone: '7654946995',
        logo: 'purdue',
        keywords: ['counselling', 'therapy', 'care', 'stress', 'low'],
        items: [
          {
            id: 'caps-individual',
            title: 'Individual Therapy',
            blurb: 'Free, brief counseling focused on your goals, with no set session limit.',
            details: 'Starts with a 30-minute phone screen with a clinician, weekdays during business hours.',
            audience: 'Purdue students',
            location: 'West Lafayette, Indiana',
            serviceType: 'Therapy',
            phone: '7654946995',
            url: 'https://www.purdue.edu/caps/students/services-and-therapies/individual.php',
          },
          {
            id: 'caps-lets-talk',
            title: "Let's Talk Drop-In",
            blurb: 'A confidential, informal drop-in chat with a Counseling and Psychological Services clinician about a brief concern.',
            details: 'Held at the HICKS LGBTQ Center, the Graduate Student Center and Shreve Hall at set weekday times; check the page for this term.',
            audience: 'Purdue students',
            location: 'West Lafayette, Indiana',
            serviceType: 'Drop-In',
            url: 'https://www.purdue.edu/caps/students/workshops/lets-talk.php',
          },
          {
            id: 'caps-group',
            title: 'Group Therapy',
            blurb: 'Students who share common concerns meet weekly through the semester. Free.',
            audience: 'Purdue students',
            location: 'West Lafayette, Indiana',
            serviceType: 'Groups',
            url: 'https://www.purdue.edu/caps/students/services-and-therapies/group/index.php',
          },
          {
            id: 'caps-uwill',
            title: 'Uwill Teletherapy',
            blurb: 'Free therapy with a licensed counselor you choose.',
            details: 'Starts after a brief screening and referral from Counseling and Psychological Services.',
            audience: 'Purdue students: online, West Lafayette and Indianapolis',
            location: 'Online',
            serviceType: 'Therapy',
            url: 'https://www.purdue.edu/caps/students/services-and-therapies/uwill.php',
          },
          {
            id: 'caps-workshops',
            title: 'Skills Workshops',
            blurb: 'Anxiety Toolbox, Wellness and Resilience, The Art of Self-Care, and Beyond Small Talk.',
            details: 'Multi-week workshops, in person or virtual. Registration required.',
            audience: 'All Purdue students, Counseling and Psychological Services client or not',
            location: 'West Lafayette, Indiana and online',
            serviceType: 'Workshops',
            url: 'https://www.purdue.edu/caps/students/workshops/index.php',
          },
          {
            id: 'caps-tao',
            title: 'Therapy Assistance Online',
            blurb: 'A free, self-guided program of short videos, exercises and reflection tools.',
            details: 'Sign in with your Purdue login.',
            audience: 'Purdue students, faculty and staff',
            location: 'Online',
            serviceType: 'Self-Help',
            url: 'https://www.purdue.edu/caps/students/resources/self-help/digital/tao.php',
          },
          {
            id: 'caps-care-management',
            title: 'Care Management',
            blurb: 'Help coordinating care across campus and community resources, at no cost.',
            details: 'Includes crisis intervention, referrals and help with financial needs.',
            audience: 'Any currently enrolled student',
            location: 'West Lafayette, Indiana',
            serviceType: 'Care Coordination',
            url: 'https://www.purdue.edu/caps/students/services-and-therapies/care-management.php',
          },
          {
            id: 'caps-psychiatry',
            title: 'Psychiatric Services',
            blurb: 'Medication evaluation and management.',
            details: 'Visits are $25. In network with Purdue Student Resources Insurance.',
            audience: 'West Lafayette students already in therapy at Counseling and Psychological Services',
            location: 'West Lafayette, Indiana',
            serviceType: 'Medical',
            url: 'https://www.purdue.edu/caps/students/services-and-therapies/psychiatric-services.php',
          },
          {
            id: 'caps-after-hours',
            title: 'After-Hours Crisis Line',
            blurb: 'Call 765-494-6995 and press 1, weekday evenings and all weekend.',
            details: 'Or call the alternative line at 855-500-5848. If life is in danger, call 911.',
            audience: 'Purdue students',
            location: 'West Lafayette, Indiana',
            serviceType: 'Crisis',
            phone: '7654946995',
            url: 'https://www.purdue.edu/caps/crisis.php',
          },
        ],
      },
      {
        id: 'crisis-text-line',
        tile: { name: 'Crisis Text Line', line: 'Text HOME to 741741' },
        title: 'Crisis Text Line',
        blurb: 'Free, 24/7 support from a live, trained volunteer crisis counselor. Message and data rates may apply.',
        sms: '741741',
        url: 'https://www.crisistextline.org/',
        logo: 'ctl',
        keywords: ['talk', 'someone', 'counselling', 'support', 'low', 'stress'],
        items: [
          {
            id: 'ctl-text',
            title: 'Text HOME To 741741',
            blurb: 'Reach a crisis counselor by text, any time.',
            location: 'National',
            serviceType: 'Text',
            sms: '741741',
            url: 'https://www.crisistextline.org/text-us/',
          },
          {
            id: 'ctl-chat',
            title: 'Chat Online',
            blurb: 'The same support through a web chat.',
            location: 'National',
            serviceType: 'Online',
            url: 'https://connect.crisistextline.org/chat',
          },
          {
            id: 'ctl-whatsapp',
            title: 'WhatsApp',
            blurb: 'Message Crisis Text Line on WhatsApp.',
            location: 'National',
            serviceType: 'Online',
            url: 'https://api.whatsapp.com/send/?phone=14437877678&text=CONNECT',
          },
          {
            id: 'ctl-spanish',
            title: 'En Español',
            blurb: 'Text HOLA to 741741 for support in Spanish.',
            location: 'National',
            serviceType: 'Text',
            sms: '741741',
            url: 'https://www.crisistextline.org/es/',
          },
        ],
      },
      {
        id: 'mha-getting-help',
        tile: { name: 'Getting Help', line: 'Where to start' },
        title: 'Getting Mental Health Help',
        blurb: 'Guides from Mental Health America on what kinds of help exist and how to start.',
        url: 'https://mhanational.org/getting-mental-health-help/',
        logo: 'mha',
        keywords: ['start', 'learn', 'guide', 'options', 'understand'],
        items: [
          ['finding-therapy', 'Find a therapist', 'How to find a therapist who fits.', 'https://mhanational.org/resources/finding-therapy/'],
          ['professionals', 'Types of mental health professionals', 'Who does what, so you know who to look for.', 'https://mhanational.org/resources/types-of-mental-health-professionals/'],
          ['support-group', 'Find a support group', 'What support groups are and how to find one.', 'https://mhanational.org/treatment-options/support-group/'],
          ['warning-signs', 'Risk factors and early warning signs', 'Signs to watch for, and how to cope.', 'https://mhanational.org/resources/recognizing-warning-signs-and-how-to-cope/'],
          ['31-tips', '31 tips to boost your mental health', 'Small things to try, one for each day of the month.', 'https://mhanational.org/resources/31-tips-to-boost-your-mental-health/'],
          ['worksheet-thoughts', 'Worksheet: negative thoughts', 'An exercise to combat negative thoughts and other cognitive distortions.', 'https://mhanational.org/wp-content/uploads/2025/03/Worksheet-Stopping-Stupid-Thoughts.pdf'],
          ['worksheet-think-ahead', 'Worksheet: think ahead', 'Map out steps you can take to get help and feel better.', 'https://mhanational.org/wp-content/uploads/2025/04/Worksheet-Think-Ahead.pdf'],
          ['advance-directive', 'Psychiatric advance directive', 'Plan ahead for how you want to be cared for in a crisis.', 'https://mhanational.org/resources/psychiatric-advance-directive/'],
          ['caregiving', 'Tips for caregivers', 'For supporting someone you care about.', 'https://mhanational.org/caregiving/'],
        ].map(([slug, title, blurb, url]) => ({
          id: `mha-guide-${slug}`,
          title: title!,
          blurb: blurb!,
          location: 'Online',
          serviceType: 'Guide',
          url: url!,
        })),
      },
      {
        id: 'mha-connect',
        tile: { name: 'Support Communities', line: 'Support & communities' },
        title: 'Connect, From Mental Health America',
        blurb: 'Hotlines, peer support and online communities that Mental Health America lists on its Connect page.',
        url: 'https://screening.mhanational.org/connect/',
        logo: 'mha',
        keywords: ['tools', 'cope', 'stress', 'self-help', 'community', 'wellbeing'],
        items: [
          {
            id: 'mha-police-alternatives',
            title: 'Alternatives To Calling The Police In A Crisis',
            blurb: 'Community-based alternatives to police in your city.',
            details: 'dontcallthepolice.com is a free database of vetted organizations, by city, that offer emergency, crisis or immediate help, covering mental health, housing, domestic violence, LGBTQ+, youth, elders and substance use. If you are in immediate danger and feel safe doing so, call 911.',
            location: 'National',
            serviceType: 'Community Support, Medical, Online, Peer-Run, Therapy',
            url: 'https://dontcallthepolice.com/',
          },
          {
            id: 'mha-warmlines',
            title: 'Need To Talk To Someone? (Warmline.org)',
            blurb: 'Local and national phone numbers for when you just need to talk.',
            details: 'Warmlines are free, confidential phone lines staffed by trained peers. Many are open 24/7; others only on certain days and times.',
            location: 'Local',
            serviceType: 'Community Support, Peer-Run',
            url: 'https://www.warmline.org/directory',
          },
          {
            id: 'mha-988',
            title: 'In Crisis – Call Someone (988)',
            blurb: 'Free national suicide prevention hotline.',
            details: 'Free, confidential support 24/7 from a network of 160+ local crisis centers. Spanish: 1-888-628-9454. Deaf or hard of hearing: 1-800-799-4889.',
            audience: 'Anyone in suicidal crisis or emotional distress',
            location: 'National',
            serviceType: 'Online',
            phone: '988',
            url: 'https://988lifeline.org/',
          },
          {
            id: 'mha-crisis-text',
            title: 'In Crisis – Text Someone',
            blurb: 'Free national text-enabled crisis intervention tool.',
            details: 'Text HOME to 741-741 to reach a trained crisis counselor, 24/7, from anywhere in the United States.',
            location: 'National',
            serviceType: 'Online',
            sms: '741741',
            url: 'https://www.crisistextline.org',
          },
          {
            id: 'mha-eating-disorder-groups',
            title: 'National Alliance For Eating Disorders: Virtual Support Groups',
            blurb: 'Connecting individuals to proper care.',
            details: 'Free Zoom groups led by licensed therapists who specialize in eating disorders. Pre-registration required. Questions: 866-662-1235.',
            audience: 'Adults 18+ with or recovering from an eating disorder, and their loved ones',
            location: 'Local',
            serviceType: 'Community Support, Groups, Online',
            phone: '8666621235',
            url: 'https://www.allianceforeatingdisorders.com/eating-disorder-support-groups-and-programs/',
          },
          {
            id: 'mha-empower-work',
            title: 'Empower Work',
            blurb: 'Immediate, free text message-based support for work-related challenges.',
            details: 'Trained peer counselors listen by text or web chat and can connect you to more resources. Text MHA to 510-674-1414.',
            audience: 'People stressed or worried about work',
            location: 'National',
            serviceType: 'Online',
            sms: '5106741414',
            url: 'https://www.empowerwork.org/',
          },
          {
            id: 'mha-osmind',
            title: 'Osmind Online Community',
            blurb: 'Free community for people dealing with treatment-resistant depression.',
            details: 'A space for mutual support and discussion, with virtual events and a free directory of clinics.',
            audience: 'People with treatment-resistant depression, and caregivers',
            location: 'Online',
            serviceType: 'Online',
            url: 'https://members.osmind.org/',
          },
          {
            id: 'mha-supportiv',
            title: 'Supportiv—The Peer Support Network',
            blurb: '24/7 live peer support chats on any struggle topic.',
            details: 'Type what you are going through and get matched anonymously into a small live chat with a trained moderator. A day pass is $24 unless your employer or health plan covers it.',
            location: 'Online',
            serviceType: 'Online',
            url: 'https://supportiv.com/individuals',
          },
          {
            id: 'mha-lyf',
            title: 'Lyf App: You’re Not Alone',
            blurb: 'Share your journey with others who will relate.',
            details: 'A free social app for sharing experiences without judgment. Optional paid support sessions. Not a substitute for treatment.',
            location: 'Online',
            serviceType: 'App',
            url: 'https://lyf.app/',
          },
          {
            id: 'mha-adaa-group',
            title: 'Anxiety And Depression Association Of America Online Peer-To-Peer Support Group',
            blurb: 'An online peer community.',
            details: 'A free, anonymous group on HealthUnlocked, run by the Anxiety and Depression Association of America.',
            audience: 'Ages 16+, and their families',
            location: 'Online',
            serviceType: 'Online',
            url: 'https://www.healthunlocked.com/anxiety-depression-support/about',
          },
          {
            id: 'mha-facebook',
            title: 'Mental Health America On Facebook',
            blurb: 'Our Facebook community.',
            details: 'More than 100,000 people supporting each other, with tips and news posted daily.',
            location: 'Online',
            serviceType: 'Online',
            url: 'https://www.facebook.com/mentalhealthamerica/',
          },
          {
            id: 'mha-inspire',
            title: 'Mental Health Forum: Mental Health America On Inspire',
            blurb: 'An online peer support community.',
            details: 'A forum moderated by Mental Health America where people support each other 24/7.',
            location: 'Online',
            serviceType: 'Online',
            url: 'https://www.inspire.com/groups/mental-health-america/',
          },
        ],
      },
      {
        id: 'nami-helpline',
        tile: { name: 'National HelpLine', line: 'Weekdays, not a crisis line' },
        title: 'National Alliance On Mental Illness HelpLine',
        blurb: 'Information and support on weekdays. Not a crisis line.',
        phone: '18009506264',
        url: 'https://www.nami.org/nami-helpline/',
        logo: 'nami',
        keywords: ['talk', 'someone', 'information', 'support', 'low', 'helpline'],
      },
      {
        id: 'findtreatment',
        tile: { name: 'FindTreatment.gov', line: 'Affordable care near you' },
        title: 'FindTreatment.gov',
        blurb: 'Search for affordable mental health care near you.',
        url: 'https://findtreatment.gov/',
        keywords: ['treatment', 'therapy', 'counselling', 'care', 'professional', 'low'],
      },
    ],
    talkTitle: 'Talk To Mental Health America',
    talkPartner: {
      name: 'Mental Health America Wabash Valley',
      region: 'Wabash Valley Region',
      phone: '7657421800',
      url: 'https://mhawv.org/',
    },
    talk: [
      {
        id: 'mha-warmlines',
        title: 'Find A Warmline',
        blurb: 'Talk with someone who has been there, when it is not a crisis.',
        url: 'https://screening.mhanational.org/content/need-talk-someone-warmlines/',
      },
    ],
    crisis: [
      {
        id: 'us-988',
        title: '988 Suicide & Crisis Lifeline',
        blurb: 'Call or text 988, any time, day or night.',
        phone: '988',
        sms: '988',
      },
      {
        id: 'us-crisis-text',
        title: 'Crisis Text Line',
        blurb: 'Text HOME to 741741, any time.',
        sms: '741741',
      },
    ],
  },
  SG: {
    groups: [],
    peer: [
      {
        id: 'sg-mindline-get-help',
        title: 'Find Support Through Mindline',
        blurb: 'Finds the services that fit, including community and peer support.',
        url: 'https://letstalk.mindline.sg/pub/get-help',
      },
      {
        id: 'sg-mindline-hangouts',
        title: 'Mindline Hangouts',
        blurb: 'An online forum to share your thoughts, or just vent, with others who get it. Therapists answer questions too.',
        url: 'https://letstalk.mindline.sg/c/hangouts/6',
      },
      {
        id: 'sg-iash-clouds',
        title: 'It All Starts Hear: Clouds',
        blurb: 'Free, small peer groups of 5 to 6 people who meet weekly for four facilitated sessions in Bishan.',
        url: 'https://www.iash.sg/iash-clouds',
      },
      {
        id: 'sg-iash-hear-buds',
        title: 'It All Starts Hear: Hear Buds',
        blurb: 'Free one-to-one chats with a trained listening buddy, by voice or video call.',
        url: 'https://www.iash.sg/peer-support',
      },
      {
        id: 'sg-limitless-programs',
        title: 'Limitless Programs And Support Groups',
        blurb: 'Programs and support groups from a youth mental health charity, to find help and build community.',
        url: 'https://www.limitless.sg/join-a-program',
      },
      {
        id: 'sg-clubheal-caregivers',
        title: 'Club HEAL Caregiver Support Network',
        blurb: 'Emotional support and coping skills for people caring for someone with a mental health condition or dementia.',
        url: 'https://www.clubheal.org.sg/crest-caregivers',
      },
    ],
    find: [
      {
        id: 'sg-mindline-tools',
        tile: { name: 'Mindline Self-Help', line: 'Tools & services guide' },
        logo: 'mindline',
        title: 'Mindline Self-Help',
        blurb: "Tools and a guide to Singapore's mental health services.",
        url: 'https://letstalk.mindline.sg/pub/get-help',
        keywords: ['tools', 'cope', 'stress', 'self-help', 'wellbeing', 'start'],
      },
      {
        id: 'sg-mindline-1771',
        tile: { name: 'Mindline 1771', line: 'Counsellor, 24 hours' },
        logo: 'mindline',
        title: 'National Mindline 1771',
        blurb: 'Talk to a mental health counsellor, 24 hours a day.',
        phone: '1771',
        keywords: ['talk', 'someone', 'counselling', 'support', 'low', 'helpline'],
      },
      {
        id: 'sg-moh-services',
        tile: { name: 'Ministry Of Health', line: 'Where to get care' },
        logo: 'moh',
        title: 'Mental Health Services (Ministry Of Health)',
        blurb: 'Where to get care in Singapore, from the Ministry of Health.',
        url: 'https://www.moh.gov.sg/seeking-healthcare/find-a-facility-or-service/mental-health-services/',
        keywords: ['treatment', 'therapy', 'care', 'professional', 'low', 'options'],
      },
    ],
    talkTitle: 'Talk To Someone',
    talk: [
      {
        id: 'sg-mindline-talk',
        title: 'National Mindline 1771',
        blurb: 'Call any time, or use WhatsApp at +65 6669 1771.',
        phone: '1771',
      },
    ],
    crisis: [
      {
        id: 'sg-sos',
        title: 'Samaritans Of Singapore',
        blurb: 'Call 1767, any time, day or night.',
        phone: '1767',
      },
      {
        id: 'sg-999',
        title: 'Emergency Services',
        blurb: 'If you or someone else is in immediate danger, call 999.',
        phone: '999',
      },
    ],
  },
  OTHER: {
    groups: [],
    peer: [{ ...DIRECTORY, id: 'other-peer', blurb: 'Search helplines and support services where you live.' }],
    find: [DIRECTORY],
    talkTitle: 'Talk To Someone',
    talk: [{ ...DIRECTORY, id: 'other-talk' }],
    crisis: [
      {
        id: 'other-crisis',
        title: 'Local Crisis Support',
        blurb: 'Contact your local emergency number, or find a crisis line near you.',
        url: 'https://findahelpline.com',
      },
    ],
  },
};

/**
 * IP country first, since that is where the person is right now. The chosen community and then the
 * device locale cover a failed lookup, so Help never waits on or depends on the network.
 */
export function resolveHelpRegion(input: {
  ipCountry?: string | null;
  communityId?: string | null;
  localeRegion?: string | null;
}): HelpRegion {
  const code = (
    input.ipCountry ||
    findCommunity(input.communityId)?.country.id ||
    input.localeRegion ||
    ''
  ).toUpperCase();
  return code === 'US' || code === 'SG' ? code : 'OTHER';
}

/** The text each mood is compared with. `query` feeds scripts/gen-resource-similarity.py. */
export const MOOD_PROFILES: Record<Mood, { query: string; keywords: string[] }> = {
  calm: {
    query: 'I feel calm and want to learn how to look after my mental wellbeing.',
    keywords: ['learn', 'understand', 'wellbeing', 'guide', 'start', 'options'],
  },
  good: {
    query: 'I feel good and want tools and a community to keep my wellbeing strong.',
    keywords: ['tools', 'community', 'wellbeing', 'learn', 'self-help'],
  },
  stressed: {
    query: 'I feel stressed and overwhelmed and need ways to cope.',
    keywords: ['stress', 'cope', 'tools', 'self-help', 'talk', 'support'],
  },
  low: {
    query: 'I feel low and sad and would like to talk to someone or find professional care.',
    keywords: ['low', 'talk', 'someone', 'support', 'counselling', 'therapy', 'treatment', 'care'],
  },
  tired: {
    query: 'I feel tired and drained and want simple ways to rest and recover my energy.',
    keywords: ['self-help', 'tools', 'wellbeing', 'cope', 'stress'],
  },
};

const KEYWORD_WEIGHT = 0.08;

const SIMILARITY_TABLE = SIMILARITY as unknown as Record<string, Record<Mood, number> | undefined>;

/** Sentence-embedding similarity, precomputed for the fixed set of moods, plus a bonus per shared keyword. */
export function scoreResource(resource: HelpResource, mood: Mood): number {
  const semantic = SIMILARITY_TABLE[resource.id]?.[mood] ?? 0;
  const wanted = new Set(MOOD_PROFILES[mood].keywords);
  const shared = (resource.keywords ?? []).filter((k) => wanted.has(k)).length;
  return semantic + shared * KEYWORD_WEIGHT;
}

/** Best match first. With no check-in today the catalog's own order stands, and ties keep it too. */
export function rankResources(resources: HelpResource[], mood: Mood | null): HelpResource[] {
  if (!mood) return resources;
  return resources
    .map((resource, i) => ({ resource, i, score: scoreResource(resource, mood) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((r) => r.resource);
}
