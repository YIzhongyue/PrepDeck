// English interface messages: the source language and the fallback for every
// other locale (issue #191). Keys are stable identifiers — rename one only
// together with its uses and every translation.
//
// Format (docs/guides/internationalization.md):
// - `{name}` is filled from the call's values; numbers are formatted for the
//   locale.
// - A key with `_one`/`_other` (or any Intl.PluralRules category) suffixes is
//   a plural message: call it by its base key with a numeric `count`.
// - `<tag>…</tag>` marks words a caller wraps in an element (`rich()`).

import type { PluralCategory } from "../core";

const en = {
  common: {
    loading: "Loading…",
    retry: "Retry",
    dismiss: "Dismiss",
    save: "Save",
    saving: "Saving…",
    cancel: "Cancel",
    close: "Close",
    delete: "Delete",
    edit: "Edit",
    remove: "Remove",
    back: "Back",
    next: "Next",
    previous: "Previous",
    done: "Done",
    search: "Search",
    clear: "Clear",
    copy: "Copy",
    copied: "Copied",
    create: "Create",
    all: "All",
    on: "On",
    off: "Off",
    today: "today",
    todayAt: "today, {time}",
    select: "Select",
    date: "Date",
    clearDate: "Clear date",
    chooseDate: "Choose date",
    togglePassword: "Toggle password visibility",
    characters: "{length} / {max} characters",
    listSeparator: ", ",
    difficulty: {
      easy: "Easy",
      medium: "Medium",
      hard: "Hard",
      unspecified: "Unspecified"
    },
    roles: {
      admin: "Admin",
      user: "User"
    }
  },
  language: {
    label: "Language",
    description: "The language of PrepDeck's menus, buttons and messages, saved in this browser. Question content and your notes stay as written.",
    loadFailed: "Could not load this language. Please retry."
  },
  nav: {
    mainNavigation: "Main navigation",
    breadcrumb: "Breadcrumb",
    more: "More",
    learningTitle: "Learning #{sequence}",
    screens: {
      dash: "Statistics",
      learning: "Learning",
      practice: "Practice",
      mock: "Mock exam",
      knowledgePoints: "Knowledge points",
      bookmarks: "Bookmarks",
      wrong: "Wrong questions",
      notes: "Annotations",
      settings: "Settings",
      admin: "Admin"
    },
    groups: {
      overview: "Overview",
      study: "Study",
      resources: "Resources",
      system: "System"
    },
    tabs: {
      dash: "Home",
      practice: "Practice",
      mock: "Mock",
      wrong: "Wrong"
    }
  },
  shell: {
    loadingExam: "Loading this exam…",
    noExams: "No exams are available yet. Ask an administrator to add an exam.",
    switching: "Saving your work before switching…"
  },
  exams: {
    title: "Exams",
    select: "Select exam",
    selectAnExam: "Select an exam",
    selectCurrent: "Select exam, current exam: {name}",
    selectCurrentWithSlug: "{slug} — Select exam, current exam: {name}",
    otherProvider: "Other"
  },
  auth: {
    expired: {
      title: "Your session has expired",
      body: "Sign in again to continue. Everything already saved is kept.",
      bodyMock: "Sign in again to continue. Everything already saved is kept, and your mock answers that could not be saved are restored when you resume the exam. Its timer keeps running.",
      notNow: "Not now",
      signInAgain: "Sign in again"
    }
  },
  profile: {
    avatarOf: "{name} avatar",
    loading: "Loading profile"
  },
  login: {
    mascotSignIn: "PrepDeck mascot holding a stack of books",
    mascotDenied: "PrepDeck mascot holding a padlock, looking apologetic",
    alreadyLinked: "Already linked",
    inviteOnly: "Invite only",
    conflictTitle: "Linked to another account",
    deniedTitle: "Access not authorized",
    conflictBody: "This address is authorized, but it's already linked to a different Google account — so signing in with this one would have adopted someone else's data. Ask an admin to reset its Google link from Authorized Users, then sign in again.",
    deniedBody: "You signed in successfully, but this account isn't on PrepDeck's authorized list. Ask an admin to invite it, then try again.",
    tryDifferentAccount: "Try a different account",
    welcome: "Welcome back!",
    tagline: "Every practice question, one deck. Sign in to start practicing or pick up where you left off.",
    signedOut: "You've been signed out. Sign in again to pick up where you left off.",
    oauthError: "Google sign-in didn't complete. Check your connection and try again — nothing was submitted.",
    verification: {
      failed: "We couldn't confirm you're human, or the check expired. Complete it again, then sign in.",
      unavailable: "Human verification is unavailable right now, so sign-in couldn't start. Nothing is wrong with your check. Try again in a few minutes.",
      misconfigured: "Sign-in is blocked by a setup problem with human verification on this server. Contact your admin."
    },
    reverified: "Verification complete. You can sign in now.",
    signingIn: "Signing in…",
    signInWithGoogle: "Sign in with Google",
    invitationOnly: "Access is by invitation only. Use the Google account your admin has approved, or contact them to request access."
  },
  legal: {
    privacy: "Privacy Policy",
    terms: "Terms of Service",
    home: "PrepDeck home",
    back: "Back to PrepDeck",
    englishOnly: "This document is available in English only. The English text is the version that applies."
  },
  turnstile: {
    label: "Human verification",
    loading: "Loading the verification check…",
    expired: "The verification expired. Refreshing it…",
    failed: "The verification check didn't complete.",
    unavailable: "The verification check couldn't load. Check your connection.",
    configFailed: "Couldn't check whether human verification is needed. Check your connection.",
    tryAgain: "Try again"
  },
  settings: {
    groups: {
      account: "Account",
      study: "Study",
      studyDesc: "How PrepDeck looks, marks and reminds you.",
      integrations: "AI & integrations",
      integrationsDesc: "Your own key, your own clients."
    },
    nav: {
      sections: "Settings sections",
      profile: "Profile",
      session: "Sign out",
      appearance: "Appearance",
      language: "Language",
      marks: "Mark aliases",
      notes: "Shared notes",
      timezone: "Time zone",
      email: "Daily email",
      ai: "AI explanations",
      mcp: "MCP access",
      aiReady: "Ready",
      aiLocked: "Locked",
      aiNotSet: "Not set"
    },
    profile: {
      yourProfile: "Your profile",
      signedInWithGoogle: "Signed in with Google",
      uploading: "Uploading…",
      uploadAvatar: "Upload avatar",
      avatarUploadFailed: "Could not upload this image.",
      displayName: "Display name",
      displayNameDesc: "From Google until you change it.",
      displayNameEmpty: "Enter a display name to save it.",
      nameSaveFailed: "Could not save your display name. Please try again."
    },
    session: {
      title: "Sign out everywhere",
      desc: "Ends your session on every device and browser. MCP tokens and connected apps are separate; revoke them below.",
      removeKey: "Also remove my saved AI key from this browser",
      signOut: "Sign out"
    },
    appearance: {
      title: "Appearance",
      desc: "Saved in this browser and applied everywhere instantly."
    },
    themes: {
      light: { name: "Light", hint: "default" },
      cream: { name: "Cream", hint: "soft" },
      sage: { name: "Sage", hint: "calm" },
      clay: { name: "Clay", hint: "warm" },
      dusk: { name: "Dusk", hint: "low light" }
    },
    marks: {
      title: "Mark aliases",
      desc: "Name what each highlight means to you. The name follows you everywhere; the color follows your theme.",
      names: {
        hl1: "First mark",
        hl2: "Second mark",
        hl3: "Third mark"
      },
      sample: "A <hl1>gateway endpoint</hl1> keeps S3 traffic inside the VPC, while <hl2>interface endpoints</hl2> use PrivateLink and <hl3>bill per hour</hl3>."
    },
    sharedNotes: {
      title: "Show other users' shared notes",
      desc: "Your own notes always show, private or shared."
    },
    timezone: {
      title: "Time zone",
      desc: "Statistics count days and weeks here, and the daily email arrives at its delivery time here.",
      now: "{offset} · {time} now",
      saveFailed: "Could not save your time zone. Please retry."
    },
    email: {
      title: "Daily review email",
      desc: "A few practice questions in your inbox — no answers included.",
      next: "Next: {when}",
      todayAt: "today {time}",
      tomorrowAt: "tomorrow {time}",
      questionsPerEmail: "Questions per email",
      deliveryTime: "Delivery time",
      inYourZone: "In your time zone, {zone}.",
      source: "Question source",
      sources: {
        wrong: { title: "Wrong book", body: "Questions you've previously answered incorrectly." },
        bm: { title: "Bookmarks", body: "Questions you've saved for later." },
        new: { title: "Unattempted", body: "Questions you haven't tried yet." }
      }
    },
    ai: {
      customModel: "Custom model id…",
      errors: {
        noKey: "Enter an API key first.",
        noPassphrase: "Choose a passphrase to encrypt the key.",
        saveFailed: "Could not save the encrypted key.",
        unlockFailed: "Wrong passphrase, or no saved key."
      },
      storage: {
        memory: "Memory only (default)",
        memoryShort: "Memory only",
        memoryBody: "Cleared the moment you refresh or close the tab. Nothing touches disk.",
        encrypted: "Encrypted in this browser",
        encryptedBody: "AES-GCM ciphertext in IndexedDB, unlocked with a passphrase each visit."
      },
      status: {
        loaded: "Key loaded for this session",
        locked: "Unlock your saved key",
        changing: "Change your key setup",
        settingUp: "Setting up your key",
        notSetUp: "Not set up yet"
      },
      manage: "Manage",
      provider: "Provider",
      model: "Model",
      keyStorage: "Key storage",
      passphrase: "Passphrase",
      choosePassphrase: "Choose a passphrase",
      passphraseHint: "Encrypted with AES-GCM and stored only in this browser. We can never recover it — lose the passphrase and the saved key is gone.",
      unlock: "Unlock",
      useDifferentKey: "Use a different key",
      forgetKey: "Forget saved key",
      stepConfigure: "Configure",
      stepKey: "Key",
      stepOf: "Step {step} of {total}",
      exactModel: "Exact model id",
      continue: "Continue",
      pasteKey: "Paste your {provider} key",
      pasteKeyDesc: "Sent to this app's server only, relayed once per request, never stored.",
      apiKey: "API key",
      replaceKey: "Replace API key",
      saveEncrypt: "Save & encrypt",
      loadKey: "Load key",
      clearKey: "Clear loaded key",
      note: "Your key is only ever sent to this app's own server, which relays it to {provider} for a single request and never stores it."
    },
    mcp: {
      title: "MCP access",
      desc: "Personal access tokens for connecting AI clients (Claude, ChatGPT, etc.) to your PrepDeck study data over MCP. Each token acts as you and can be revoked at any time.",
      namePlaceholder: "e.g. claude-desktop"
    },
    connections: {
      title: "Connected apps",
      desc: "AI clients you connected by signing in with Google and approving access, instead of a token. Each acts as you with the access you approved, until you disconnect it."
    }
  },
  mcp: {
    tokens: {
      created: "Created {when}",
      neverUsed: "Never used",
      lastUsed: "Last used {when}",
      expired: "Expired {when}",
      expires: "Expires {when}",
      neverExpires: "Never expires",
      loadFailed: "Could not load tokens.",
      nameRequired: "Name is required.",
      createFailed: "Could not create this token.",
      revokeConfirm: "Revoke \"{name}\"? Anything using this token stops working immediately.",
      revokeFailed: "Could not revoke this token.",
      rotateConfirm: "Rotate \"{name}\"? The current token stops working immediately and a new one takes its place.",
      rotateFailed: "Could not rotate this token.",
      tokenCopied: "Token copied.",
      promptCopied: "Setup prompt copied.",
      setupIntro: "Copy the setup prompt into your AI chatbot to connect PrepDeck. Enter your token securely in the client when prompted.",
      copySetupPrompt: "Copy setup prompt",
      createButton: "+ Create token",
      name: "Name",
      namePlaceholder: "e.g. local-cli",
      expiration: "Expiration",
      expiry: {
        never: "Never",
        days_one: "{count} day",
        days_other: "{count} days",
        year: "1 year"
      },
      creating: "Creating…",
      create: "Create token",
      copyNow: "Copy \"{name}\" now — it won't be shown again",
      newToken: "New MCP token",
      hide: "Hide",
      show: "Show",
      copySetupPromptWithToken: "Copy setup prompt with token",
      includesSecret: "Includes a secret. Pasting this shares your token with the selected AI service.",
      copyFailedToken: "Could not copy to the clipboard. Select and copy the token below.",
      copyFailedPrompt: "Could not copy to the clipboard. Select and copy the setup prompt below.",
      copyManuallyToken: "Token to copy manually",
      copyManuallyPrompt: "Setup prompt to copy manually",
      empty: "No tokens yet.",
      status: {
        active: "active",
        revoked: "revoked",
        expired: "expired"
      },
      rotate: "Rotate",
      revoke: "Revoke",
      rotating: "Rotating \"{name}\" stops the current token immediately and issues a new one.",
      completeCheck: "Complete the check, then rotate.",
      rotateToken: "Rotate token"
    },
    connections: {
      readWrite: "Read and write",
      readOnly: "Read only",
      connected: "Connected {when}",
      idle: "Idle too long — reconnect from the app",
      loadFailed: "Could not load connected apps.",
      thisApp: "this app",
      disconnectConfirm: "Disconnect {name}? It stops working immediately and has to be connected again to regain access.",
      disconnectFailed: "Could not disconnect this app.",
      disabled: "New connections are turned off on this server; existing ones stop working until they are turned back on.",
      empty: "No connected apps.",
      unnamed: "Unnamed app",
      statusConnected: "connected",
      statusExpired: "expired",
      disconnect: "Disconnect"
    },
    scopes: {
      userRead: { label: "Read your study data", description: "Exams, questions, your attempts, statistics, annotations and Knowledge Points." },
      userWrite: { label: "Record study activity and edit your notes", description: "Start and answer practice sessions, set your Learning Mode position, and create, edit or delete your Knowledge Points." },
      adminRead: { label: "Read the question bank as an administrator", description: "Every exam and question, quality-control reports, statistics, exports and import previews." },
      adminWrite: { label: "Change the shared question bank", description: "Create, update, archive and delete questions and exams, run imports and edit the tag catalog for every user." }
    },
    connect: {
      errors: {
        invalid_client: {
          title: "Unknown app",
          body: "PrepDeck doesn't recognize the app that sent you here, so nothing was connected. Go back to the app and connect again; if it keeps happening, the app may not support PrepDeck's sign-in."
        },
        invalid_redirect_uri: {
          title: "Can't return to the app",
          body: "The app asked to return to an address it didn't register, so PrepDeck stopped before showing anything. Nothing was connected. Reconnect from the app."
        },
        invalid_request: {
          title: "Invalid connection request",
          body: "The app's request was malformed, so nothing was connected. Reconnect from the app."
        },
        unavailable: {
          title: "Connecting apps isn't available",
          body: "This PrepDeck server doesn't accept sign-in from MCP apps. Use a personal access token from Settings → MCP access instead, if the app supports one."
        }
      },
      loadFailed: "PrepDeck couldn't load this connection request. Reload the page, or reconnect from the app.",
      decideFailed: "That didn't go through. Check your connection and try again.",
      ended: "This request has ended",
      connected: "Connected",
      notConnected: "Not connected",
      returning: "Returning you to the app. If nothing happens, you can close this tab and continue there.",
      unnamedApp: "An unnamed app",
      title: "Connect {app} to PrepDeck?",
      adminRequired: "Administrator access required",
      actsAsYou: "It will act as you on {server} with the access below, until you disconnect it.",
      adminOnly: "{app} asked for PrepDeck Admin MCP, which only an active administrator can approve. Return to the app without connecting.",
      app: "App",
      unverified: "unverified",
      unverifiedTitle: "The app describes itself; PrepDeck has not verified who publishes it.",
      clientId: "Client ID {id}",
      returnsTo: "Returns to",
      server: "Server",
      administrativeAccess: "administrative access",
      account: "Account",
      ableTo: "It will be able to",
      trust: "Only connect apps you trust. You can disconnect it at any time from {place}; signing out of PrepDeck does not disconnect it.",
      placeAdmin: "Admin → MCP tokens",
      placeSettings: "Settings → MCP access",
      connecting: "Connecting…",
      allow: "Allow access",
      returningShort: "Returning…",
      returnToApp: "Return to the app"
    }
  },
  stats: {
    loading: "Loading statistics…",
    unavailable: "Unavailable",
    unavailableRetry: "Unavailable. Retry to load this data.",
    noExam: "No exam selected",
    noExamBody: "Choose an exam from the workspace switcher to see your statistics.",
    loadFailed: "Could not load {what}. Everything else on this page is unaffected.",
    failures: {
      statistics: "statistics",
      activity: "study activity",
      plan: "your study plan"
    },
    passed: "Passed",
    belowLine: "Below line",
    zoneTime: "{city} time",
    signedPoints: "{sign}{count} pts",
    duration: {
      minutes: "{minutes}m",
      hours: "{hours}h",
      hoursMinutes: "{hours}h {minutes}m"
    },
    header: {
      greeting: "Good to see you, {name}",
      greetingAnonymous: "Good to see you",
      tracking: "Here's how your <exam>{name}</exam> prep is tracking today.",
      chooseExam: "Choose an exam to see how your preparation is tracking.",
      continue: "Continue practice",
      setUp: "Set up practice"
    },
    countdown: {
      daysLeft_one: "Exam {date} · {count} day left",
      daysLeft_other: "Exam {date} · {count} days left",
      today: "Exam {date} · today",
      passed: "Exam {date} · passed"
    },
    plan: {
      title: "Study plan",
      loadFirst: "Load your study plan before editing it.",
      unavailable: "Study plan unavailable",
      loading: "Loading study plan…",
      changeLabel: "{countdown}. Change your study plan.",
      setDate: "Set exam date",
      saveFailed: "Could not save your study plan. Please try again.",
      forExam: "For {exam}.",
      forActive: "For the active exam.",
      optional: "Both are optional — clear a field to remove it.",
      examDate: "Exam date",
      invalidDate: "Enter a real calendar date.",
      countdownHint: "Counted down in whole days ({zone}).",
      weeklyGoal: "Weekly study goal (hours)",
      goalRange: "Enter between {min} and {max} hours.",
      goalHint: "Measured against recorded session time, Monday to Sunday."
    },
    readiness: {
      title: "Exam readiness",
      noBank: "This exam has no questions yet, so there is nothing to measure.",
      noAttempts: "Answer some questions and a readiness estimate will appear here.",
      smallSample: "Readiness needs at least {min} answered questions; you are at {answered}. Until then this shows bank coverage only.",
      thisExam: "this exam",
      noPassMark: "Difficulty-weighted estimate across the {pct}% of {subject} you have seen. This exam has no pass mark set, so there is no line to compare against.",
      above_one: "You are {count} point above the {pass}% pass line. Keep the weak tags below from slipping.",
      above_other: "You are {count} points above the {pass}% pass line. Keep the weak tags below from slipping.",
      below_one: "You are {count} point below the {pass}% pass line. The weak tags below are where the distance is.",
      below_other: "You are {count} points below the {pass}% pass line. The weak tags below are where the distance is.",
      ringReady: "ready",
      ringCovered: "covered",
      ringAriaReady: "Readiness",
      ringValue: "Readiness {pct}%",
      ringValuePass: "Readiness {pct}%, against a {pass}% pass line",
      ringUnavailable: "Readiness is not available yet. Bank coverage is {pct}%.",
      method: "Difficulty-weighted method v{version}, from {answers} answers across {questions} questions. Not a predicted exam score.",
      covered: "Question bank covered",
      coverageValue: "{seen} / {total} · {pct}%",
      emptyBank: "No questions in this bank yet",
      coverageAria: "Bank coverage {pct} percent",
      noWeakTags: "No tag has both enough answered questions to judge and questions left to practise.",
      practises: "Practises {tags}",
      practiceWeak: "Practice weak tags",
      startMock: "Start mock exam"
    },
    first: {
      kicker: "Get started",
      title: "Answer your first questions",
      titleCount: "Answer your first {count} questions",
      about: "About {count} minutes, drawn from questions you have not seen.",
      noneLeft: "There are no unattempted questions to draw from.",
      fillIn: "Accuracy, the trend chart and your weakest domains fill in once there are answers to measure.",
      start: "Start questions",
      startCount: "Start {count} questions",
      learn: "Read with answers first"
    },
    answered: {
      label: "Answered",
      suffix: "/ {total}",
      footer: "+{added} new in {days} days · {unseen} unseen",
      progress: "{pct} percent of the bank answered"
    },
    accuracy: {
      label: "Accuracy",
      notMeasured: "Not measured yet",
      notMeasuredPass: "Not measured yet · {pass}% pass line",
      answersNoPass_one: "{count} answer · no pass mark set",
      answersNoPass_other: "{count} answers · no pass mark set",
      answersVsPass_one: "{count} answer · vs {pass}% pass line",
      answersVsPass_other: "{count} answers · vs {pass}% pass line"
    },
    wrongBook: {
      label: "Wrong book",
      suffix: "saved",
      empty: "Nothing saved yet",
      footer: "{repeated} missed more than once · {recent} in the last 7 days",
      strip: "{saved} unmastered questions, {repeated} of them missed more than once"
    },
    bestMock: {
      label: "Best mock",
      footer_one: "{date} · {count} attempt",
      footer_other: "{date} · {count} attempts",
      empty: "No mock exams completed yet",
      bars: "Scores of the last {count} mock exams: {scores}"
    },
    focus: {
      title: "Where to focus",
      status: {
        weakest: "weakest",
        belowLine: "below line",
        onTrack: "on track",
        notMeasured: "not measured · needs {count} answers"
      },
      mix: {
        mostlyHard: "mostly hard",
        mediumHeavy: "medium-heavy",
        mostlyEasy: "mostly easy",
        mixed: "mixed"
      },
      wrong: "{count} wrong",
      unseen: "{count} unseen",
      nothingLeft: "nothing left to practise",
      notRanked: "Not ranked yet: a tag is measured after {count} answers. Until then, the tags with the most questions to practise come first.",
      ranked: "Weakest tags first, hard questions weighted",
      rankedPass: "Weakest tags first, hard questions weighted, against the {pass}% pass line",
      showTop: "Show top tags",
      viewAll: "View all {count} tags",
      empty: "No tagged questions in this bank yet, so there is nothing to rank.",
      meterUnmeasured: "{tag}: not enough answers to measure accuracy",
      meter: "{tag}: {pct}% accuracy over {count} answers",
      allPractisedTitle: "Every {tag} question has been answered and none is in your wrong book.",
      allPractised: "All practised",
      practice: "Practice {count}"
    },
    trend: {
      title: "Accuracy trend",
      loading: "Loading the accuracy trend…",
      summary_one: "Accuracy over the last {count} active day, from {from}% on {fromDay} to {to}% on {toDay}.",
      summary_other: "Accuracy over the last {count} active days, from {from}% on {fromDay} to {to}% on {toDay}.",
      noPassMark: "This exam has no pass mark set.",
      passLineIs: "The pass line is {pass}%.",
      empty: "No completed answers yet, so there is no accuracy trend to show.",
      subtitle_one: "Last {count} active day (days are counted in {zone})",
      subtitle_other: "Last {count} active days (days are counted in {zone})",
      needsAnswer: "Needs at least one completed answer",
      passLine: "Pass line",
      completeSession: "Complete a practice or mock session and the trend appears here.",
      latest: "{pct}% latest",
      latestNoPass: "this exam has no pass mark set",
      aboveLine: "above the line",
      belowLine: "below the line",
      caption: "Accuracy by active day"
    },
    studyTime: {
      title: "Study time",
      loading: "Loading study time…",
      summaryEmpty: "No completed study sessions this week.",
      summary_one: "{time} of recorded study time across {count} session this week.",
      summary_other: "{time} of recorded study time across {count} sessions this week.",
      summaryGoal: "The weekly goal is {goal}.",
      summaryNoGoal: "No weekly goal is set.",
      summaryGoalUnavailable: "Weekly goal unavailable.",
      summaryMissing_one: "{count} session did not record a duration.",
      summaryMissing_other: "{count} sessions did not record a duration.",
      ofGoal: "{time} of {goal} weekly goal",
      recorded: "{time} recorded this week",
      goalUnavailable: "Weekly goal unavailable",
      goalLoading: "Loading weekly goal…",
      goalPct: "{pct}% of goal",
      setGoal: "Set weekly goal",
      sessions_one: "{count} session",
      sessions_other: "{count} sessions",
      noDurations: "No session durations recorded",
      average: "{time} average",
      longest: "Longest {day} · {time}",
      footnote: "Recorded session time, Monday to Sunday in {zone}.",
      footnoteMissing_one: "{count} session recorded no duration and shows as “?”.",
      footnoteMissing_other: "{count} sessions recorded no duration and show as “?”.",
      caption: "Recorded study time by day this week"
    },
    table: {
      show: "Show the numbers",
      empty: "No data yet.",
      day: "Day",
      date: "Date",
      answers: "Answers",
      correct: "Correct",
      sessions: "Sessions",
      recordedTime: "Recorded time"
    },
    heatmap: {
      day_one: "{date}: {count} question",
      day_other: "{date}: {count} questions",
      noPractice: "{date}: no practice",
      less: "Less",
      more: "More"
    },
    detail: {
      summary: "More detail: difficulty, mock history and long-range activity",
      byDifficulty: "By difficulty",
      difficultyProgress: "{difficulty}: {pct} percent",
      noAttempts: "No attempts yet.",
      mockHistory: "Mock exam history",
      completed: "Completed",
      score: "Score",
      questions: "Questions",
      result: "Result",
      noMocks: "No mock exams completed yet.",
      activity: "Study activity",
      activitySummary: "Last {days} days · {active} active days · {withDuration} of {sessions} sessions recorded a duration · avg session {minutes} min"
    }
  },
  study: {
    question: "Question",
    questionN: "Question {n}",
    ofTotal: "of {total}",
    yourAnswer: "Your answer",
    tabs: {
      explanation: "Explanation",
      notes: "Notes",
      related: "Related",
      history: "History"
    },
    optionStatus: {
      yoursCorrect: "Your answer · Correct",
      correct: "Correct answer",
      yoursIncorrect: "Your answer · Incorrect"
    },
    gate: {
      loadFailed: "Could not load this question. Please retry.",
      loading: "Loading question…",
      retry: "Retry question",
      refresh: "Refresh exam"
    },
    structured: {
      orderLegend: "Choose each item in order",
      matchLegend: "Choose a match for each item",
      position: "Position {n}",
      match: "Match {id}",
      select: "Select…",
      correctResponse: "Correct response: {response}"
    },
    bookmark: "Bookmark",
    tags: "Tags",
    review: "Review",
    showMore: "Show more",
    showLess: "Show less",
    correct: "Correct",
    incorrect: "Incorrect",
    officialExplanation: "Official explanation",
    studied: {
      label: "Studied",
      markStudied: "Mark as studied",
      markUnstudied: "Mark as unstudied"
    },
    copyPrompt: {
      label: "Copy as prompt",
      title: "Copy question and answers as a Markdown prompt",
      failed: "Copy failed",
      copiedAnnounce: "Markdown prompt copied to clipboard.",
      failedAnnounce: "Could not copy the Markdown prompt."
    },
    underReview: {
      badge: "Under review",
      notice: "This question is currently under review and may contain disputed or uncertain content."
    },
    options: {
      single: "Answer options, choose one",
      multiple: "Answer options, choose all that apply",
      review: "Answer options"
    },
    ai: {
      title: "AI explanation",
      cached: "cached",
      generated: "generated",
      notCached: "not cached",
      regenerate: "Regenerate",
      relaying: "Relaying to {provider} …",
      checking: "Checking the shared cache …",
      alreadyExplained: "Already explained with <model>{name}</model>",
      showIt: "Show it",
      noCached: "No cached explanation for {provider} · {model} yet.",
      generate: "Generate explanation",
      noKey: "No API key loaded. Add one in Settings to generate a fresh explanation.",
      addKey: "Add an API key in Settings",
      unlockToGenerate: "Unlock your saved key to generate this",
      unlocking: "Unlocking…"
    },
    history: {
      emptyTitle: "No attempts yet",
      emptyBody: "Not answered in Practice or Mock mode.",
      mock: "Mock",
      practice: "Practice",
      answered: "Answered <answer>{value}</answer>"
    },
    revision: {
      title: "Answer revised",
      historical: "This result reflects the answer key at the time of the attempt. Historical scores are unchanged.",
      gradedKey: "Graded answer key: {key}.",
      legacy: "The original answer key was not recorded for this legacy attempt."
    },
    filters: {
      all: { label: "Any status", desc: "Studied and unstudied questions alike" },
      unstudied: { label: "Unstudied only", desc: "Never shown in Learning or answered, or marked unstudied" },
      studied: { label: "Studied only", desc: "Shown in Learning, or answered in Practice or Mock" }
    }
  },
  notes: {
    emptyError: "A question note cannot be empty.",
    editNote: "Edit note",
    saveFailed: "Could not save. Your draft is retained; please retry.",
    placeholder: "Write a note for this question…",
    forQuestion: "Note for this question",
    visibilityLabel: "Note visibility",
    save: "Save note",
    visibility: {
      private: "private",
      shared: "shared",
      privateLabel: "Private",
      sharedLabel: "Shared"
    }
  },
  setup: {
    questions_one: "{count} question",
    questions_other: "{count} questions",
    underReview: {
      title: "Questions under review",
      desc_one: "{count} question in this exam is still being reviewed and may contain disputed or uncertain content.",
      desc_other: "{count} questions in this exam are still being reviewed and may contain disputed or uncertain content.",
      include: "Include",
      includeDesc: "They can appear, each marked as under review",
      skip: "Skip",
      skipDesc: "Leave them out of this session"
    },
    studyStatus: {
      title: "Study status",
      desc: "Studied means shown in Learning or answered in Practice or Mock, not mastered.",
      unavailable: "Your study status could not be loaded, so questions may show as unstudied. Refresh the exam to try again."
    },
    moreOptions: {
      title: "More options",
      desc: "Optional. The defaults suit most sessions.",
      hide: "Hide",
      customize: "Customize"
    },
    difficulty: {
      label: "Difficulty",
      desc: "Filter by question difficulty.",
      any: "Any"
    },
    domains: {
      title: "Domains",
      desc: "All included unless you select specific ones.",
      none: "This exam has no domains yet.",
      searchPlaceholder: "Search {count} domains",
      search: "Search domains",
      clearSearch: "Clear search",
      filters: "Domain filters",
      noMatch: "No domains match “{query}”.",
      showFewer: "Show fewer",
      showAll: "Show all {count} domains",
      selectResults: "Select all results ({count})",
      selected: "{count} selected",
      selectResultsHint: "Select all results replaces your current domain selection."
    },
    summary: {
      title: "Session summary",
      matches_one: "{count} question matches your filters",
      matches_other: "{count} questions match your filters",
      source: "Source",
      questions: "Questions",
      estimatedTime: "Estimated time",
      minutes: "~{count} min",
      skipped: "Skipped",
      included: "Included",
      start: "Start session"
    }
  },
  practice: {
    setup: {
      title: "Build a practice session",
      intro: "Untimed. Pick where questions come from and how many, then start. Everything else is optional.",
      source: "Question source",
      sourceDesc: "Choose which questions to practice.",
      count: "Question count",
      countDesc: "Choose 5–40 questions, about {minutes} minutes each.",
      countPresets: "Question count presets",
      feedback: "Answer feedback",
      feedbackDesc: "Choose when to see answers and explanations.",
      hiddenNote: "Annotations and notes stay hidden while you answer. They reappear as soon as a question is graded."
    },
    shortcuts: {
      title: "Keyboard shortcuts",
      selectOption: "Select an option",
      selectLetter: "Select by letter",
      check: "Check answer / next question"
    },
    live: {
      correctCount: "{count} correct",
      incorrectCount: "{count} incorrect",
      noTimer: "No timer · feedback per question",
      checkCount: "Check answer ({chosen}/{need})",
      check: "Check answer",
      finish: "Finish",
      next: "Next question",
      end: "End",
      endSession: "End session",
      incorrectAdded: "Incorrect — added to your wrong book",
      correctAnswer: "Correct answer: {answer}.",
      explanationBelow: "The explanation is open below.",
      explanationRight: "The explanation is open on the right.",
      lockedTitle: "Explanation and notes are locked",
      lockedBody: "They open as soon as you check your answer, so nothing gives the answer away."
    },
    sources: {
      all: { label: "All questions", desc: "The full bank for this exam" },
      new: { label: "Unattempted", desc: "Questions you have never answered" },
      focus: { label: "Unattempted + wrong", desc: "New questions plus misses you have not mastered" },
      wrong: { label: "Wrong book", desc: "Misses you have not mastered yet" },
      bm: { label: "Bookmarked", desc: "Questions you saved for later" }
    },
    emptySource: {
      all: { title: "This exam has no questions yet", body: "Questions appear here once they are added to the bank." },
      new: { title: "You have answered every question", body: "Nothing in this bank is unattempted any more." },
      focus: { title: "Nothing new or unmastered left", body: "You have answered every question, and your wrong book is clear." },
      wrong: { title: "Your wrong book is empty", body: "Questions you answer incorrectly in Practice or Mock are saved here until you master them." },
      bm: { title: "No bookmarked questions yet", body: "Bookmark a question while you study and it is saved here." }
    },
    feedback: {
      immediate: { label: "Per question", desc: "See the answer and explanation after each check" },
      end: { label: "At the end", desc: "Answer everything first, then review" }
    },
    difficulty: {
      any: "Any difficulty",
      easy: "Easy only",
      medium: "Medium only",
      hard: "Hard only"
    },
    empty: {
      practiceUnattempted: "Practice unattempted questions ({count})",
      practiceAll: "Practice all questions ({count})",
      allStudiedTitle: "You have studied every matching question",
      noneStudiedTitle: "You have not studied any matching question yet",
      allStudiedBody: "Every question that fits your other choices has been shown in Learning or answered. Mark a question as unstudied in Learning to practise it here again.",
      noneStudiedBody: "None of the questions that fit your other choices has been shown in Learning or answered yet.",
      practiceMatching_one: "Practice all {count} matching question",
      practiceMatching_other: "Practice all {count} matching questions",
      noMatchTitle: "No questions match these filters",
      noMatchBody_one: "{source} has {count} question, but none fit your domain, difficulty, study status and review choices.",
      noMatchBody_other: "{source} has {count} questions, but none fit your domain, difficulty, study status and review choices.",
      clearFilters: "Clear domain, difficulty and study status filters"
    },
    summary: {
      reviewSkipped: "under review skipped",
      reviewIncluded: "under review included",
      feedback: {
        immediate: "feedback per question",
        end: "feedback at the end"
      }
    }
  },
  learning: {
    live: {
      title: "Question #{sequence}",
      position: "{n} of {total}",
      exit: "Exit",
      progress: "Learning progress",
      jumpPlaceholder: "Jump to #",
      jumpLabel: "Jump to question number",
      go: "Go",
      last: "Last question",
      accepted: "Accepted answer(s)"
    },
    setup: {
      title: "Work through the bank in order",
      intro: "Answers revealed, nothing graded. Pick where to start, narrow by domain, then read on.",
      allStudiedBody: "Every question that fits your other choices has been shown in Learning or answered. Mark one as unstudied while learning to see it here again.",
      learnMatching_one: "Learn all {count} matching question",
      learnMatching_other: "Learn all {count} matching questions",
      noMatchBody: "None of this exam's questions fit your domain, difficulty, study status and review choices.",
      clearAll: "Clear all filters",
      resumeTitle: "Pick up where you left off",
      resumeBody: "You left off at question #{sequence}.",
      resume: "Resume",
      start: "Starting point",
      startDesc: "Questions run in sequence order from here.",
      startFrom: "Start from question #",
      startFromRange: "Start from question # (1–{max})",
      numberingGaps: "Numbers are fixed question IDs, not positions: {count} of the numbers from 1 to {max} match your filters. A number that is skipped starts at the next one.",
      startsAt: "Starts at",
      begin: "Start learning",
      note: "Every question shows its correct answer, your own answer history, explanations and notes right away. Nothing is graded, and nothing is added to the wrong question book. Each question shown is marked as studied, and you can mark it unstudied again."
    }
  },
  questionTypes: {
    chooseN: "Choose {count}",
    single: "Single choice",
    trueFalse: "True / false",
    ordering: "Order the items",
    matching: "Match the items",
    fillBlank: "Fill in the blank"
  },
  pager: {
    label: "Question pages",
    page: "Page {current} of {pages}",
    goTo: "Go to page",
    invalid: "Enter a whole page number from 1 to {pages}."
  },
  lists: {
    wrongTitle: "Wrong question book",
    practiceThese: "Practice these {count}",
    saved: "saved",
    wrongTimes: "{count}× wrong · {date}",
    removeBookmark: "Remove bookmark",
    markMastered: "Mark mastered",
    emptyBookmarksTitle: "Nothing saved yet",
    emptyBookmarksBody: "Bookmark a question while practising and it lands here.",
    emptyWrongTitle: "Wrong book is clear",
    emptyWrongBody: "Every question you missed has been mastered. Nice."
  },
  tagFilter: {
    label: "Filter by tag",
    resultOf_one: "{n} of {count} question",
    resultOf_other: "{n} of {count} questions",
    tagsSelected_one: "{count} tag selected",
    tagsSelected_other: "{count} tags selected",
    allTags: "all tags",
    clear: "Clear filters",
    searchPlaceholder: "Search tags…",
    search: "Search tags",
    noOtherMatch: "No other tags match “{query}”.",
    noMatch: "No tags match “{query}”.",
    showMore: "Show {count} more",
    hint: "Selecting several tags shows questions carrying any of them."
  },
  kp: {
    untitled: "Untitled knowledge point",
    ungrouped: "Ungrouped",
    groups: "Groups",
    tags: "Tags",
    unlink: "Unlink",
    reviewInLearning: "Review in Learning",
    reviewInLearningTitle: "Opens in Learning mode for review. No attempt is recorded.",
    list: {
      sorts: {
        updated: "Last updated",
        title: "Title",
        created: "Created",
        custom: "Custom order"
      },
      justNow: "just now",
      updated: "Updated {when}",
      linkedQuestions_one: "{count} linked question",
      linkedQuestions_other: "{count} linked questions",
      noLinkedQuestions: "No linked questions",
      screenshots_one: "{count} screenshot",
      screenshots_other: "{count} screenshots",
      diagrams_one: "{count} diagram",
      diagrams_other: "{count} diagrams",
      note: "note",
      reorder: "Reorder {title} with arrow keys, or drag",
      moveUp: "Move {title} up",
      moveDown: "Move {title} down",
      acrossExams: "Available across all exams",
      intro: "Concept-level notes you write and organise yourself. Private to you — link them to any question across your exams.",
      new: "New knowledge point",
      scopeAll: "All personal knowledge points",
      scopeExam: "Related to this exam",
      allNotes: "All notes",
      matchesAll: "matches all",
      search: "Search titles and note text…",
      results_one: "{count} result",
      results_other: "{count} results",
      reload: "Reload notes",
      reorderOffExam: "Reordering is off in the exam-filtered view.",
      reorderOffFilter: "Reordering is off while a search or tag filter is active.",
      showAllToReorder: "Show all notes to reorder",
      clearToReorder: "Clear filters to reorder",
      emptyTitle: "No knowledge points yet",
      emptyBody: "Write one explanation per concept, link the questions it covers, and it becomes your own revision outline.",
      createFirst: "Create your first note",
      noSearchMatch: "No notes match “{query}”",
      noTagMatch: "No notes match these tags",
      noExamNotes: "No notes linked to this exam yet",
      tryDifferent: "Try a different search or clear your filters.",
      linkOrBrowse: "Link a knowledge point to a question in this exam, or browse your full library.",
      resetFilters: "Reset filters",
      viewAll: "View all personal knowledge points",
      loadMore: "Load more notes",
      loadAllToReorder: "Load the complete group before reordering its review sequence.",
      customHint: "Custom order · drag the grip, use Space then arrow keys on the grip, or use the move buttons."
    },
    editor: {
      waitingImage: "Waiting for image…",
      notSaved: "Not saved",
      saved: "Saved",
      savedAt: "Saved · {time}",
      unsaved: "Unsaved changes",
      leaveFailed: "Your note could not be saved. Please retry before leaving.",
      retryLoad: "Retry loading note",
      loading: "Loading note",
      copied: "Markdown copied",
      copyFailed: "Could not copy. Use Markdown mode to select the text.",
      titleLabel: "Knowledge point title",
      titleRequired: "A title is required before this note can be saved.",
      removeTag: "Remove tag {name}",
      previousIn: "Previous in {group}",
      nextIn: "Next in {group}",
      focusMode: "Focus mode",
      focusModeTitle: "Focus mode: hide the sidebar",
      moreActions: "More actions",
      copyMarkdown: "Copy as Markdown",
      download: "Download .md file",
      deleteNote: "Delete note…",
      conflictTitle: "This note was saved from another tab or device since you started editing.",
      conflictBody: "Keep your local changes (overwriting the other save) or reload the latest version (discarding yours).",
      reloadLatest: "Reload latest",
      keepMine: "Keep mine",
      saveFailed: "Save failed.",
      textSafe: "Your text is safe in the editor.",
      discardMetadata: "Discard failed metadata change",
      retryNow: "Retry now",
      details: "Note details",
      onThisPage: "On this page",
      outline: "Outline",
      relatedQuestions: "Related questions",
      unavailable_one: "{count} linked question is no longer available to you.",
      unavailable_other: "{count} linked questions are no longer available to you.",
      linkHint: "Link the questions this note explains, so you can review them together.",
      linkQuestion: "Link a question",
      meta: "Created {created} · Edited {edited}",
      uploadingImage: "Uploading image…",
      body: "Knowledge point body",
      imageRules: "Choose a PNG, JPEG or WebP image up to 8 MB.",
      uploadFailed: "Upload failed. Your text is retained.",
      linkInvalid: "Use an https, http, mailto or relative link.",
      imageFailed: "Couldn’t add the image.",
      retryUpload: "Retry upload",
      dismissUpload: "Dismiss upload",
      placeholder: "Start writing. Type <kbd>/</kbd> for tables, images and diagrams, or paste Markdown.",
      sourceHint: "This is exactly what’s saved. Switch back to Visual any time; nothing is lost.",
      source: "Markdown source",
      drop: "Drop to add the image here",
      dropRules: "PNG, JPEG or WebP, up to 8 MB",
      insertBlock: "Insert a block",
      blocks: "Blocks",
      slashMove: "move",
      slashInsert: "insert",
      slashKeep: "keep as text",
      editLink: "Edit link",
      linkUrl: "Link URL",
      linkUrlHint: "https, http, mailto or a relative link",
      removeLink: "Remove link",
      apply: "Apply",
      formatSelection: "Format selection",
      italic: "Italic",
      inlineCode: "Inline code",
      linkShortcut: "Link · {shortcut}",
      tableControls: "Table controls",
      addRow: "Add row",
      addColumn: "Add column",
      removeRow: "Remove row",
      removeColumn: "Remove column",
      removeTable: "Remove table",
      words_one: "{count} word",
      words_other: "{count} words",
      readingTime_one: "About {count} minute to read",
      readingTime_other: "About {count} minutes to read",
      hintBlocks: "blocks",
      hintLink: "link",
      hintMarkdown: "Markdown shortcuts work"
    },
    manage: {
      title: "Groups & tags",
      intro: "Groups are flat — a note belongs to at most one. Tags overlap freely. Both are private to you and separate from the question bank’s tags.",
      rename: "Rename {name}",
      renameButton: "Rename",
      notes_one: "{count} note",
      notes_other: "{count} notes",
      onNotes_one: "on {count} note",
      onNotes_other: "on {count} notes",
      groupCount_one: "{count} group",
      groupCount_other: "{count} groups",
      createFailed: "Could not create group",
      deleteGroupConfirm_one: "Delete \"{name}\"? Its {count} note will move to Ungrouped and keep its content, tags, and question links.",
      deleteGroupConfirm_other: "Delete \"{name}\"? Its {count} notes will move to Ungrouped and keep their content, tags, and question links.",
      builtIn: "built-in",
      newGroup: "New group name",
      addGroup: "Add group",
      groupRules: "Names must be unique and non-blank. Deleting a group moves its notes to Ungrouped, keeping their order.",
      caseInsensitive: "case-insensitive",
      deleteTagConfirm_one: "Delete the tag \"{name}\"? This removes it from {count} note — the notes themselves are not affected.",
      deleteTagConfirm_other: "Delete the tag \"{name}\"? This removes it from {count} notes — the notes themselves are not affected.",
      noTags: "No tags yet — add one from a note.",
      tagRules: "Renaming updates every note that uses the tag. Deleting removes the association only — the notes stay."
    },
    delete: {
      label: "Delete knowledge point",
      title: "Delete “{title}”?",
      removes: "This removes {items}.",
      theNote: "the note",
      itsScreenshots_one: "its {count} screenshot",
      itsScreenshots_other: "its {count} screenshots",
      itsLinks_one: "its links to {count} question",
      itsLinks_other: "its links to {count} questions",
      kept: "The questions and your tags are not deleted.",
      keptWithGroup: "The questions, the {group} group, and your tags are not deleted.",
      failed: "Could not delete this note. Please retry.",
      confirm: "Delete note"
    },
    groupPicker: {
      group: "Group",
      label: "Group: {name}",
      moveTo: "Move to group",
      newGroup: "New group",
      newGroupEllipsis: "New group…",
      namePlaceholder: "Group name",
      hint: "The note moves into it once it’s created.",
      enterName: "Enter a group name.",
      tooLong: "Group names can be at most {max} characters.",
      exists: "A group named “{name}” already exists."
    },
    tagPicker: {
      add: "Add tag",
      placeholder: "Add tag…",
      yours: "Your tags",
      create: "Create “{name}”"
    },
    link: {
      intro: "Search by question ID or text across every exam you can access.",
      close: "Close question picker",
      search: "Search titles and question text…",
      allExams: "All exams",
      matches: "{count} matches · showing {shown}",
      linked: "Linked",
      link: "Link",
      noQuestions: "No matching questions.",
      reviewNote: "Opening a linked question goes to review — it never records an attempt.",
      saveFailed: "Could not save the question link. Retry from the note's save status."
    },
    linkExisting: {
      title: "Link an existing note",
      search: "Search your knowledge points…",
      none: "No matching knowledge points.",
      failed: "Could not link this note. Please retry."
    },
    related: {
      linkExisting: "Link existing",
      newNote: "+ New note",
      reload: "Reload related notes",
      empty: "No knowledge points reference this question yet.",
      loadFailed: "Could not load related notes. Please retry.",
      createFailed: "Could not create and link your note. Retry New note to continue with the same draft."
    },
    blocks: {
      h1: { title: "Heading 1", hint: "Large section heading" },
      h2: { title: "Heading 2", hint: "Medium section heading" },
      h3: { title: "Heading 3", hint: "Small section heading" },
      bullets: { title: "Bulleted list", hint: "A simple list" },
      numbers: { title: "Numbered list", hint: "Steps in order" },
      quote: { title: "Quote", hint: "Callout or exam tip" },
      table: { title: "Table", hint: "3 rows, 2 columns, header row" },
      image: { title: "Image", hint: "Upload, paste or drop · PNG, JPEG or WebP up to 8 MB" },
      code: { title: "Code block", hint: "Monospace, keeps spacing" },
      diagram: { title: "Diagram", hint: "Mermaid flowchart" },
      divider: { title: "Divider", hint: "A line between sections" }
    },
    toolbar: {
      label: "Note formatting",
      styles: {
        h0: "Paragraph",
        h1: "Heading 1",
        h2: "Heading 2",
        h3: "Heading 3"
      },
      textStyle: "Text style",
      textStyleCurrent: "Text style: {style}",
      locked: "Finish or dismiss the image upload first",
      link: "Link",
      insert: "Insert",
      tip: "Tip: type <kbd>/</kbd> on an empty line to insert without leaving the keyboard.",
      undo: "Undo",
      redo: "Redo",
      mode: "Editor mode",
      visual: "Visual"
    },
    paste: {
      pasted_one: "Pasted {count} word as formatted Markdown.",
      pasted_other: "Pasted {count} words as formatted Markdown.",
      plain: "Paste as plain text instead"
    },
    media: {
      enlarged: {
        image: "Enlarged image",
        diagram: "Enlarged diagram"
      },
      close: {
        image: "Close enlarged image",
        diagram: "Close enlarged diagram"
      }
    },
    blocksView: {
      unsupported: "Unsupported Markdown — editable source",
      unsupportedSource: "Unsupported Markdown source",
      language: "Language",
      codeLanguage: "Code language",
      codeSource: "Code source",
      editDiagram: "Edit diagram source",
      previewDiagram: "Preview diagram",
      viewLargerImage: "View larger image",
      badImageUrl: "This image URL is not supported.",
      altText: "Alt text",
      imageAltText: "Image alt text",
      removeImage: "Remove image"
    },
    diagram: {
      tooLarge: "Diagram is too large. Use at most 12,000 characters and 250 lines.",
      failed: "Diagram failed to render",
      didNotRender: "Diagram didn’t render — {error}",
      preview: "Preview",
      source: "Source",
      viewLarger: "View larger diagram"
    }
  },
  errors: {
    requestFailed: "Request to {path} failed with {status}",
    ai: {
      noKey: "Enter your API key in Settings first.",
      generateFailed: "Could not generate an explanation."
    },
    annotations: {
      saveNote: "Could not save the annotation note. Please retry before leaving.",
      delete: "Could not delete the annotation. Please retry."
    },
    question: {
      changed: "This question changed. Refresh the exam and try again.",
      loadFailed: "Could not load this question."
    },
    learning: {
      position: "Could not save your learning position. Please try navigating again.",
      studyStatus: "Could not save this question's study status. Please retry."
    },
    mock: {
      start: "Could not start this mock exam. Please retry.",
      answerPending: "Mock answer is not saved yet. It will be retried before switching or submitting.",
      timeUp: "Time is up. This mock exam has been submitted with the answers saved before the deadline.",
      alreadySubmitted: "This mock exam was already submitted from another tab or device. Showing its result.",
      answerRejected: "This answer could not be saved, so your last saved answer to this question stands. The question may have changed; reload to see its current version.",
      flagPending: "Mock flag is not saved yet. It will be retried before switching or submitting.",
      submit: "Could not submit this mock exam. Your answers are retained; please retry."
    },
    nav: {
      noteFirst: "Save or discard your question note before switching.",
      cancelled: "Navigation was cancelled because your changes could not be saved. Please retry saving.",
      examUnavailable: "This exam is unavailable. Choose another exam.",
      switchConfirm: "Switch study context? Practice answers will be saved and the practice ended. Mock answers will be saved so you can resume; its timer keeps running.",
      saveBeforeSwitch: "Could not save your work. Please retry before switching.",
      saveNote: "Could not save your current note. Please retry before leaving.",
      examNotAvailable: "That exam is not available to you.",
      switchFailed: "Could not switch: {reason}. Your work is retained; retry saving or switching."
    },
    practice: {
      start: "Could not start practice. Please try again.",
      ended: "This practice session has ended, so this answer was not saved. Your earlier answers are kept; start a new session to continue.",
      answer: "Could not save your answer. Please submit it again.",
      note: "Could not save your question note. Your draft is retained; retry before changing questions.",
      finish: "Could not finish this practice. Please retry; your session is retained.",
      bookmark: "Could not save bookmark changes. Please retry.",
      mastered: "Could not mark this question mastered. Please retry."
    },
    notes: {
      save: "Could not save your note. Your draft is retained; please retry.",
      delete: "Could not delete this note. Please retry."
    },
    appearance: {
      invalid: "Invalid appearance response. Please reload and retry.",
      unavailable: "Site appearance is unavailable"
    },
    workspace: {
      refreshExams: "Could not refresh your exams. Your current work is retained; please retry.",
      loadExams: "Could not load your exams. Please retry.",
      selectedGone: "The selected exam is no longer available. Select an available exam to continue.",
      switchUnavailable: "This exam is unavailable. Your work is retained; retry saving and switching to an available exam.",
      linkedUnavailable: "The linked exam is not available to you. Another exam has been opened instead.",
      previousUnavailable: "Your previous exam is unavailable. An available exam has been selected.",
      refreshExam: "Could not refresh this exam. Your current work is retained; please retry.",
      loadExam: "Could not load this exam. Please retry.",
      linkedQuestionGone: "This linked question is no longer available.",
      noSuchQuestion: "This exam has no question {sequence}."
    },
    kp: {
      resolveConflict: "Resolve the revision conflict before saving.",
      saveFailed: "Save failed. Please retry.",
      composing: "Finish composing your text before leaving.",
      unsaved: "Your note still has unsaved changes. Retry saving before leaving.",
      loadNote: "Could not load this note. Retry or return to your list.",
      loadNotes: "Could not load your notes. Please retry.",
      loadMore: "Could not load more notes. Please retry.",
      stillMoving: "Still saving the last move. Wait for it to finish, then try again.",
      cannotReorder: "This view cannot be reordered. Open a single group with custom sort to change the order.",
      orderChanged: "The order changed in another tab. The latest order has been loaded; try your move again.",
      orderFailed: "Could not save the new order. Your previous order is retained; please retry.",
      uploadFailed: "Image upload failed. Retry or dismiss the upload before leaving."
    },
    avatar: {
      type: "Please choose a JPEG, PNG, or WebP image.",
      read: "Could not read this image file.",
      process: "Could not process this image.",
      tooLarge: "This image is too large even after compression — please choose a smaller file."
    }
  },
  admin: {
    header: {
      eyebrow: "Admin workspace",
      title: "Access & content",
      intro: "Invite the people who study here, and keep the exam library tidy."
    },
    tabs: {
      label: "Admin sections",
      overview: "Overview",
      users: "People",
      exams: "Content",
      mcp: "MCP tokens",
      appearance: "Appearance"
    },
    count: {
      exams_one: "{count} exam",
      exams_other: "{count} exams",
      questions_one: "{count} question",
      questions_other: "{count} questions"
    },
    mcp: {
      title: "Admin MCP tokens",
      desc: "Privileged tokens for admin-side AI clients (e.g. local-codex, chatgpt-admin) that need question-bank management access. These are separate from, and cannot be used as, User MCP tokens.",
      namePlaceholder: "e.g. local-codex",
      connectionsTitle: "Connected admin apps",
      connectionsDesc: "Clients you connected to Admin MCP by signing in and approving administrative access. They lose access at once if you disconnect them or stop being an administrator."
    },
    status: {
      checking: "Checking status…",
      checkingDetail: "Loading the admin overview.",
      unavailable: "Status unavailable",
      failedDetail: "The admin overview failed to load: {message}",
      slow: "Slow to respond",
      slowDetail: "The admin overview took more than {seconds} s ({time}).",
      ok: "Operational",
      okDetail: "The admin overview loaded at {time}."
    },
    overview: {
      requestFailed: "The request did not complete.",
      loadFailed: "Could not load the overview.",
      kicker: "At a glance",
      title: "Workspace overview",
      intro: "Live totals across your PrepDeck workspace.",
      activeLearners: "Active learners",
      authorizedTotal: "{count} authorized total",
      library: "Question library",
      across: "Across {exams}",
      attempts: "Attempts recorded",
      allTime: "All-time activity",
      invites: "Pending invites",
      revoked: "{count} access revoked",
      coverage: "Content coverage",
      byExam: "Questions by exam",
      manageContent: "Manage content",
      noExams: "No exams yet.",
      quick: "Quick actions",
      quickTitle: "What would you like to do?",
      invite: "Invite a teammate",
      inviteDesc: "Grant workspace access",
      addExam: "Add an exam",
      addExamDesc: "Grow the content library"
    },
    users: {
      loadFailed: "Could not load the Authorized Users list.",
      inviteFailed: "Could not invite this account.",
      updateFailed: "Could not update this account.",
      bulkFailed: "Could not update the selected accounts.",
      revokeConfirm: "Revoke access for {email}? Historical data is kept; this can be undone with Restore.",
      resetConfirm: "Reset the Google link for {email}? The next Google account that signs in with this address takes over this account and all of its data. Only do this if you know the account changed hands legitimately.",
      bulkRevokeConfirm_one: "Revoke access for {count} account? This can be undone with Restore.",
      bulkRevokeConfirm_other: "Revoke access for {count} accounts? This can be undone with Restore.",
      search: "Search people",
      searchPlaceholder: "Search people…",
      filters: {
        all: "All",
        active: "Active",
        invited: "Invited",
        revoked: "Revoked"
      },
      invitePeople: "Invite people",
      makeAdmin: "Make admin",
      makeUser: "Make user",
      revokeAccess: "Revoke access",
      selectAll: "Select all shown people",
      select: "Select {email}",
      person: "Person",
      role: "Role",
      roleOf: "Role for {email}",
      status: "Status",
      lastSignIn: "Last sign-in",
      you: "you",
      resetLink: "Reset link",
      resetLinkTitle: "Unlink the Google account this row answers to, so the next sign-in with this address claims it",
      restore: "Restore",
      noMatch: "No users match “{query}”.",
      footnote: "Invited accounts activate on their first Google sign-in. Revoking keeps all historical data and can be undone.",
      inviteTitle: "Invite an account",
      inviteSubtitle: "Access starts on their first Google sign-in.",
      googleEmail: "Google email",
      tempPassword: "Temporary password",
      tempPasswordPlaceholder: "optional — dev / local only",
      tempPasswordHint: "Only used while this deployment signs in with email + password.",
      createdInvited: "Created with status “invited”.",
      inviting: "Inviting…",
      sendInvite: "Send invite"
    },
    exams: {
      loadFailed: "Could not load exams.",
      providersFailed: "Could not load providers. Reopen Content to retry.",
      assignFailed: "Could not update provider assignment.",
      badgeAfterCreate: "Exam created, but its badge could not be uploaded: {reason}",
      uploadFailed: "upload failed",
      createFailed: "Could not create this exam.",
      archiveConfirm: "Archive \"{name}\"? It will be hidden from practice/mock setup for all users.",
      updateFailed: "Could not update this exam.",
      badgeFailed: "Could not upload this badge icon.",
      search: "Search exams",
      searchPlaceholder: "Search exams…",
      allProviders: "All providers",
      new: "New exam",
      newSubtitle: "The slug is used in imports and URLs — keep it stable.",
      archived: "archived",
      active: "active",
      questionsUnit_one: "question",
      questionsUnit_other: "questions",
      open: "Open",
      noMatch: "No exams match.",
      name: "Name",
      slug: "Slug",
      subject: "Subject",
      subjectPlaceholder: "Architecture",
      language: "Language",
      badgeIcon: "Badge icon",
      badgeHint: "square PNG / SVG",
      browse: "Browse",
      addQuestionsAfter: "You can add questions right after.",
      create: "Create exam",
      badge: "badge",
      editDetails: "Edit details",
      replaceBadge: "Replace badge",
      addBadge: "Add badge",
      archive: "Archive",
      unarchive: "Unarchive",
      providersHint: "Tap to assign or unassign this exam."
    },
    examSettings: {
      title: "Edit exam details",
      subtitle: "Badge, providers, official format and archiving are edited separately.",
      nameRequired: "Name is required.",
      slugInvalid: "Slug: lowercase letters and digits in hyphen-separated groups, e.g. aws-sap-c02.",
      passInvalid: "Pass mark is a percentage from 0 to 100.",
      saveFailed: "Could not save these details.",
      description: "Description",
      passMark: "Pass mark (%)",
      passUnused: "Not used while the official exam format is set: mocks pass at that format's share of correct answers.",
      passHint: "Mock exams pass at this share of correct answers. Leave blank for no pass mark.",
      slugWarning: "The slug is part of this exam's URLs and of the links in daily review emails already sent, and import files and integrations may refer to it. Links that use <slug>{old}</slug> stop working once it changes.",
      slugConfirm: "Change the slug to <slug>{next}</slug>",
      onlyChanged: "Only the fields you changed are saved.",
      noChanges: "No changes yet.",
      save: "Save details"
    },
    format: {
      title: "Official exam format",
      intro: "The real test's length, time limit and pass mark. Mock exams offer full, half and sprint lengths from it, and pass at the same share of correct answers.",
      replacesPass: "It replaces the {pass}% pass mark once set.",
      fillAll: "Fill in all three values.",
      wholeNumbers: "Use whole numbers above zero.",
      passTooHigh: "Correct answers to pass cannot exceed the number of questions.",
      saveFailed: "Could not save the exam format.",
      passCount: "Correct answers to pass",
      save: "Save format",
      saved: "Saved.",
      summary: "Pass mark {pass}% · {minutes} min per question.",
      notSet: "Not set — mock exams offer sprint and custom lengths only."
    },
    providers: {
      title: "Providers",
      manage: "Manage providers",
      new: "New provider",
      edit: "Edit provider",
      none: "No providers yet.",
      noneActive: "No active providers.",
      noneAtAll: "No providers.",
      deleteConfirm: "Permanently delete \"{name}\"? This cannot be undone. Providers assigned to exams cannot be deleted; archive them instead.",
      updateFailed: "Could not update this provider. Please retry.",
      editSubtitle: "Providers group exams in menus and selectors.",
      manageSubtitle: "Archive providers to hide them from selectors while keeping their exams and questions.",
      showArchived: "Show archived providers",
      iconRules: "Choose a JPEG, PNG, or WebP icon no larger than 2 MB.",
      pleaseRetry: "Please retry.",
      iconFailed: "Provider saved, but its icon could not be updated.",
      saveFailed: "Could not save provider.",
      shortName: "Short name",
      website: "Official URL",
      icon: "Icon",
      currentIcon: "Current provider icon",
      iconHint: "JPEG, PNG, or WebP · up to 2 MB",
      removeIcon: "Remove current icon",
      assignHint: "Assign exams from any exam’s detail page.",
      save: "Save provider",
      add: "Add provider"
    },
    mascot: {
      title: "Site mascot",
      intro: "Choose the mascot used throughout PrepDeck, including sign-in. This setting applies to everyone.",
      loading: "Loading current mascot…",
      current: "Current mascot: {style}",
      loadFailed: "Could not load the current mascot. The last available style is still displayed.",
      retry: "Retry loading",
      style: "Mascot style",
      styles: {
        chibi3d: "3D Chibi",
        anime2d: "2D Anime"
      },
      preview: "{style} preview",
      currentStyle: "Current site style",
      previewShort: "Preview",
      save: "Save mascot",
      saved: "Mascot updated for everyone. Other users will see it when they refresh or return to PrepDeck.",
      saveFailed: "Could not save. Please retry.",
      kept: "Your selection is kept; you can retry saving."
    }
  },
  authoring: {
    types: {
      single_choice: "Single choice",
      multiple_choice: "Multiple choice",
      true_false: "True / false",
      fill_blank: "Fill in the blank",
      ordering: "Ordering",
      matching: "Matching"
    },
    typesInline: {
      single_choice: "single choice",
      multiple_choice: "multiple choice",
      true_false: "true / false",
      fill_blank: "fill in the blank"
    },
    fields: {
      type: "Type",
      stem: "Stem",
      options: "Options",
      correctAnswers: "Correct answers",
      explanation: "Official explanation",
      externalId: "External ID",
      difficulty: "Difficulty",
      points: "Points",
      tags: "Tags",
      needsReview: "Needs review"
    },
    list: {
      range: "{range} of {total}",
      export: "Export this page",
      exportFailed: "Could not export questions",
      import: "Import JSON",
      add: "Add question",
      searchLabel: "Search stem or exact internal / external ID",
      searchPlaceholder: "Search stem or exact ID…",
      filterType: "Filter by type",
      allTypes: "All types",
      filterDifficulty: "Filter by difficulty",
      allDifficulties: "All difficulties",
      filterTag: "Filter by exact tag",
      exactTag: "Exact tag",
      filterReview: "Filter by review state",
      anyReview: "Any review state",
      needsReview: "Needs review",
      reviewed: "Reviewed",
      filterArchived: "Filter by archived state",
      anyStatus: "Any status",
      activeOnly: "Active only",
      archivedOnly: "Archived only",
      bankEmpty: "This question bank is empty. Add a question to start authoring.",
      noMatch: "No questions match the current filters.",
      archivedAt: "Archived {when}",
      archivedTag: "Archived",
      id: "ID: {id}",
      externalId: "External ID: {id}",
      archiveConfirm: "Archive question #{sequence}? Learners will no longer get it in practice, mock exams, Learning Mode or review lists. Its answers, notes and other history are kept, and you can restore it at any time.",
      archived: "Archived question #{sequence}.",
      restored: "Restored question #{sequence}.",
      archiveFailed: "Could not archive question.",
      restoreFailed: "Could not restore question.",
      deleteConfirm: "Delete this question permanently? Questions with attempts, bookmarks, notes or other learning records cannot be deleted; archive them instead.",
      deleted: "Deleted question #{sequence}.",
      deleteFailed: "Could not delete question.",
      saved: "Saved question #{sequence}.",
      savedWithId: "Saved question #{sequence} ({id}).",
      imported: "Import completed. Review the per-question results in the import dialog."
    },
    editor: {
      editTitle: "Edit question",
      close: "Close question editor",
      revision: "revision {revision}",
      view: "Question view",
      stale: "Someone saved a newer version of this question while you were editing.",
      saveFailed: "Could not save this question. Your input has been kept.",
      discardLatestTitle: "Discard edits and load latest?",
      discardLatestBody: "Your unsaved changes will be replaced with the latest saved question.",
      discardLatestAction: "Discard and load latest",
      loadedRevision: "Loaded revision {revision}.",
      changedSince: "Changed since you opened it: {fields}.",
      editsKept: "Your edits are kept; review them and save again.",
      loadLatestFailed: "Could not load the latest version.",
      loadLatestFailedReason: "Could not load the latest version: {reason}",
      changedType: "Changed to {type}. {cleared}",
      clearedBoth: "Options and correct answers were cleared.",
      clearedOptions: "Options were cleared.",
      clearedAnswers: "Correct answers were cleared.",
      removedOption: "Removed option {id}.",
      removedCorrectOption: "Removed option {id} (a correct answer).",
      stemMarkdown: "Stem · Markdown",
      optionsAnswers: "Options & correct answers",
      selectAtLeastTwo: "Select at least two correct answers.",
      selectOne: "Select one correct answer.",
      option: "Option {id}",
      correctAnswerFor: "Correct answer {id}",
      removeOption: "Remove option {id}",
      optionMarkdown: "Option {id} · Markdown",
      addOption: "Add option",
      acceptedAnswers: "Accepted answers (one per line)",
      blankLines: "Blank lines are ignored.",
      explanationMarkdown: "Official explanation · Markdown",
      externalIdLabel: "External ID (optional, unique in this exam)",
      needsReviewHelp: "Review state is stored on the question itself, not as a tag. Imports set it; clear it once the question has been checked.",
      markdownPreview: "Markdown preview",
      yourEditsKept: "Your edits are kept.",
      loadKeep: "Load latest and keep my edits",
      discardMine: "Discard my edits",
      checkFields: "Check the highlighted fields. Your input has been kept.",
      savedRevision: "Saved revision {revision}. No unsaved changes.",
      noUnsaved: "No unsaved changes",
      saveAddNext: "Save & add next"
    },
    component: {
      title: "Edit component question",
      intro: "Edit the structured package. The preview updates when the question is valid.",
      fields: {
        body: "Question body",
        interaction: "Interaction",
        stimuli: "Shared material",
        assets: "Assets",
        correctResponse: "Correct response",
        archive: "Archive status"
      },
      answerEditFailed: "Could not change the answer while preserving undo history. Your source has been kept. Edit the answer in JSON.",
      previousRestored: "Previous draft restored.",
      nextRestored: "Next draft restored.",
      formatUndoFailed: "Could not format JSON while preserving undo history. Your source has been kept.",
      formatFailed: "Could not format JSON. Your source has been kept.",
      saveFailed: "Could not save question",
      discardLatestBody: "Your raw JSON will be replaced with the latest saved question.",
      changedSinceRevision: "Changed since revision {revision}: {fields}.",
      noChangesSince: "No content changes since revision {revision}.",
      rawKept: "Your raw JSON is kept.",
      draftMatches: "Your draft now matches the latest saved question.",
      reviewThenSave: "Review the question, then Save when ready.",
      tryAgain: "Please try again.",
      changed: "This question has changed.",
      view: "Editing view",
      answerControls: "Answer controls",
      formatJson: "Format JSON",
      packageJson: "Question package JSON",
      packageErrors: "Question package errors",
      syntaxError: "JSON syntax error: {message}",
      syntaxErrorAt: "JSON syntax error at line {line}, column {column}: {message}",
      validationErrors: "Package validation errors:",
      preview: "Component question preview",
      previewStale: "Preview is out of date. Showing the most recent valid draft.",
      previewNone: "No valid preview yet. Correct the package errors to see a preview.",
      leftPreviewItems: "Left preview items",
      rightPreviewItems: "Right preview items",
      table: "Question table",
      missingFigure: "Missing figure: {alt}"
    },
    answers: {
      label: "Answer configuration",
      sequence: "Correct sequence",
      matches: "Correct matches",
      intro: "Change the correct answer here. Edit content, IDs and structure in JSON.",
      answer: "Answer {id}",
      idCode: "ID: <code>{id}</code>",
      moveUp: "Move {id} up",
      moveDown: "Move {id} down",
      up: "↑ Up",
      down: "↓ Down",
      moved: "{id} moved to position {position} of {total}.",
      rightReuse: "A right item may be used more than once or left unused.",
      leftItems: "Left items",
      rightItems: "Right items",
      leftIdCode: "Left ID: <code>{id}</code>",
      rightIdCode: "Right ID: <code>{id}</code>",
      leftId: "Left ID: {id}",
      rightId: "Right ID: {id}",
      rightFor: "Right item for {id}",
      matchChanged: "Match for {id} changed.",
      reasons: {
        tooLarge: "Answer controls support packages up to the 5 MiB import limit. Keep this source in JSON.",
        invalid: "Answer controls require one valid schema 2.0 question without duplicate keys. Correct the package errors in JSON.",
        duplicates: "Answer controls are unavailable for duplicate keys. Resolve the ambiguous object properties in JSON.",
        unsupported: "Answer controls support sorting and matching only. Edit this question in JSON.",
        failed: "Answer controls could not inspect this source. Keep editing in JSON."
      }
    },
    json: {
      invalid: "Invalid JSON syntax.",
      unlocated: "Check the JSON syntax; its error location could not be determined.",
      schemaVersion: "must be \"2.0\"",
      oneQuestion: "must contain exactly one question in this editor",
      validateFailed: "Could not validate this package. Check its structure and try again.",
      location: "line {line}, column {column}",
      duplicateKey: "Duplicate object key {name} at {location}; first declared at {first}. Remove or rename one key before saving.",
      duplicateLimit: "Only the first 50 duplicate keys are shown. Correct these and check again.",
      duplicateFailed: "Could not check this package for duplicate keys. Reduce its nesting and try again; your source has been kept.",
      formatChanges: "Could not format JSON without changing its content. Your source has been kept.",
      syntax: {
        InvalidSymbol: "Unexpected symbol. Use a JSON value or punctuation.",
        InvalidNumberFormat: "Invalid JSON number.",
        PropertyNameExpected: "Expected a double-quoted property name.",
        ValueExpected: "Expected a JSON value.",
        ColonExpected: "Expected a colon after the property name.",
        CommaExpected: "Expected a comma between values or properties.",
        CloseBraceExpected: "Expected a closing brace (}).",
        CloseBracketExpected: "Expected a closing bracket (]).",
        EndOfFileExpected: "Unexpected content after the JSON value.",
        InvalidCommentToken: "Comments are not allowed in JSON.",
        UnexpectedEndOfComment: "Comments are not allowed in JSON.",
        UnexpectedEndOfString: "This string is missing its closing double quote.",
        UnexpectedEndOfNumber: "This number is incomplete.",
        InvalidUnicode: "This string contains an invalid Unicode escape.",
        InvalidEscapeCharacter: "This string contains an invalid escape sequence.",
        InvalidCharacter: "This string contains an unescaped control character."
      }
    },
    import: {
      title: "Import questions",
      intro: "New questions are appended to this exam. Existing content is kept unless you explicitly apply an incoming version below.",
      pdfTitle: "Prepare questions from a PDF",
      pdfBody: "Convert your PDF with the pdf-to-quiz skill, check the questions and answers against the original pages, then upload the resulting JSON below.",
      capabilities: "Supported content: {blocks}. Answer interactions: {interactions}. Legacy and component JSON imports are supported.",
      schemasFailed: "PDF preparation formats could not be loaded. You can still import a prepared JSON file.",
      schemasLoading: "Loading PDF preparation formats…",
      downloadSchemas: "Download conversion schemas",
      file: "Question import JSON file",
      tooLarge: "Import file must be at most 5 MiB.",
      validateFailed: "Could not validate file.",
      failed: "Import failed. Refresh the preview before retrying.",
      processing: "Processing…",
      incoming_one: "{count} incoming question",
      incoming_other: "{count} incoming questions",
      conflicts_one: "{count} conflict",
      conflicts_other: "{count} conflicts",
      previewTitle: "Preview imported questions",
      previewNote: "Showing up to five questions. Review the complete source before importing.",
      current: "Current: {value}",
      incomingValue: "Incoming: {value}",
      ambiguous: "Multiple questions share this external ID. Correct their IDs in the editor, then validate the import again.",
      resolution: "Resolution",
      keep: "Keep current",
      apply: "Apply incoming version",
      results: "Import results",
      summary: "Created {created} · Updated {updated} · Skipped / conflicting {skipped} · Failed {failed}",
      retryNote: "Only retry failed or conflicting records. Questions without external IDs are new records on every import.",
      execute: "Import with selected resolutions"
    },
    guard: {
      title: "Discard unsaved changes?",
      body: "Your question changes have not been saved. Discard them to continue.",
      action: "Discard changes",
      keep: "Keep editing"
    },
    preview: {
      notSelected: "Not selected",
      noAnswers: "Correct answers: Not selected"
    },
    tags: {
      lengthError: "Enter a tag name of 1–{max} characters.",
      selected: "Selected tags",
      placeholder: "Search or create a tag…",
      available: "Available tags",
      alreadySelected: "This tag is already selected.",
      loading: "Loading tags…",
      none: "No matching tags. Type a name to create one.",
      hint: "Select an existing tag or create one. Changes are saved with the question.",
      limit: "Up to {max} tags per question. Remove a tag to add another.",
      loadFailed: "Could not load tags. You can still edit this question.",
      retry: "Retry tags"
    },
    classifications: {
      filterBy: "Filter by {label}",
      unclassified: "Unclassified / ambiguous ({count})",
      loadFailed: "Classification filters could not be loaded.",
      retry: "Retry filters"
    }
  },
  annotations: {
    underline: "Underline",
    bold: "Bold",
    deleteMark: "Delete mark",
    title: "My annotations",
    selectHint: "Select any text below to highlight, underline or bold it.",
    private: "Marks are private to you and never appear while you answer.",
    filter: "Filter:",
    clearFilter: "Clear filter",
    sort: "Sort marks",
    oldest: "Oldest first",
    newest: "Newest first",
    filterFailed: "Could not apply this filter. The marks shown may be out of date.",
    noMatchTitle: "No marks match this filter",
    noMatchBody: "None of your marks in this exam use the selected mark types.",
    emptyTitle: "No annotations yet",
    emptyBody: "Select text in a question to highlight, underline or bold it: in Learning, or once you have checked an answer in Practice or submitted a mock exam. Your marks and question notes collect here.",
    goLearning: "Go to Learning",
    marks_one: "{count} mark",
    marks_other: "{count} marks",
    markNote: "Add a note to this mark…"
  },
  mock: {
    setup: {
      title: "Simulate the real thing",
      intro: "Timed, randomly drawn, no feedback until you submit.",
      requiredCorrect: "{required} of {total} correct",
      notSet: "Not set",
      inProgress: "You have an exam in progress",
      answered: "{answered} of {total} answered.",
      answeredLeft_one: "{answered} of {total} answered · {count} minute left on the server clock.",
      answeredLeft_other: "{answered} of {total} answered · {count} minutes left on the server clock.",
      resumeOrSubmit: "Resume it, or submit it before starting a new one.",
      resume: "Resume exam",
      format: "Format",
      formatDesc: "Choose the length and time limit.",
      formats: {
        full: "Full exam",
        half: "Half length",
        sprint: "Sprint",
        custom: "Custom"
      },
      formatSize: "{count} questions · {minutes} min",
      formatSizeFull: "{count} questions · {minutes} min. Matches the real test.",
      customDesc: "Set your own length and time",
      timeLimit: "Time limit (minutes)",
      countError: "Enter a whole number from 1 to {max}.",
      minutesError: "Enter a whole number of minutes from {min} to {max}.",
      noOfficial: "Full and half-length exams appear once an admin sets this exam's official format.",
      howItWorks: "How it works",
      rules: {
        random: { title: "Random draw, no repeats", desc: "Questions are sampled from the whole bank." },
        noFeedback: { title: "No feedback until you submit", desc: "Flag anything you want to revisit before submitting." },
        serverClock: { title: "Server-side clock", desc: "The timer keeps running if you close the tab." },
        autosave: { title: "Answers save as you go", desc: "A dropped connection never costs the attempt." }
      },
      summary: "Exam summary",
      minutes: "Minutes",
      pace: "Pace",
      paceValue: "{minutes} min / question",
      passMark: "Pass mark",
      shortBank_one: "This bank has {count} question, so the exam uses all of them.",
      shortBank_other: "This bank has {count} questions, so the exam uses all of them.",
      shortBankPace_one: "This bank has {count} question, so the exam uses all of them, at the same pace.",
      shortBankPace_other: "This bank has {count} questions, so the exam uses all of them, at the same pace.",
      shortBankSkipping_one: "Without the questions under review, this bank has {count} question, so the exam uses all of them.",
      shortBankSkipping_other: "Without the questions under review, this bank has {count} questions, so the exam uses all of them.",
      shortBankSkippingPace_one: "Without the questions under review, this bank has {count} question, so the exam uses all of them, at the same pace.",
      shortBankSkippingPace_other: "Without the questions under review, this bank has {count} questions, so the exam uses all of them, at the same pace.",
      allUnderReview: "Every question in this exam is under review. Include them to begin an exam.",
      resumeInProgress: "Resume in-progress exam",
      begin: "Begin exam"
    },
    live: {
      timeLeft: "{minutes} minutes {seconds} seconds left",
      lowTime: "Under 5 minutes left",
      serverClock: "Server clock · answers save as you go",
      answeredOf: "Answered {answered} of {total}",
      flag: "Flag",
      flagged: "Flagged",
      submitExam: "Submit exam",
      reviewSubmit: "Review & submit",
      palette: "Question palette",
      answered: "Answered",
      left: "Left",
      notAnswered: "Not answered",
      answeredState: "answered",
      flaggedState: "flagged",
      stateSeparator: ", "
    },
    results: {
      nCorrect: "{count} correct",
      above: "+{count} above",
      short: "{count} short",
      missed: "Missed",
      unanswered: "{count} left unanswered",
      toReview: "to review",
      timeUsed: "Time used",
      minutes: "{count} min",
      notPassed: "Not passed",
      below: "Below the pass mark",
      aboveMark: "Above the pass mark",
      complete: "Exam complete",
      heroSub: "{minutes} min used · {total} questions · {correct} correct",
      newMock: "New mock",
      noMisses: "No misses to practice",
      practiceMisses_one: "Practice the {count} miss",
      practiceMisses_other: "Practice the {count} misses",
      breakdown: "Question breakdown",
      breakdownSub: "Bookmark anything worth revisiting, or open its knowledge points.",
      filter: "Filter questions",
      filterAll: "All {count}",
      filterMissed: "Missed {count}",
      filterCorrect: "Correct {count}",
      domain: "Domain",
      yours: "Yours",
      actions: "Actions",
      emptyView: "No questions in this view.",
      questionKps: "Question knowledge points"
    },
    submit: {
      title: "Submit your exam?",
      answered_one: "You have answered {answered} of {count} question.",
      answered_other: "You have answered {answered} of {count} questions.",
      answeredFlagged: "You have answered {answered} of {total} questions and flagged {flagged}.",
      warning: "Unanswered questions are graded as incorrect, and you can't change answers after submitting.",
      keepGoing: "Keep going",
      submit: "Submit"
    }
  }
};

export default en;

// ---------------------------------------------------------------------------
// Types derived from the English resources. They make every `t()` key a
// compile-time check and shape what a translation may contain.

type Tree = typeof en;

type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

type StripPlural<K extends string> = K extends `${infer Base}_${PluralCategory}` ? Base : K;

/** Every message key, plural messages by their base key. */
export type TranslationKey = StripPlural<Leaves<Tree>>;

type PluralBases<T> = { [K in keyof T & string]: K extends `${infer Base}_${PluralCategory}` ? Base : never }[keyof T & string];

/**
 * A translation's shape: any subset of the English keys (a missing message
 * falls back to English), with plural messages free to use whichever
 * categories the language's plural rules need. An unknown key is a type error.
 */
export type Translation<T = Tree> = {
  [K in keyof T as K extends `${string}_${PluralCategory}` ? never : K]?: T[K] extends string ? string : Translation<T[K]>;
} & {
  [K in PluralBases<T> as `${K}_${PluralCategory}`]?: string;
};

export type LocaleMessages = Translation;
