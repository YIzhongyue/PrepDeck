// Japanese (ja) interface messages (issue #191). Same keys as ./en.ts, which
// is the source of truth; a key left out here falls back to English.
// Plural messages need only `_other`: Japanese has no grammatical plural.
// docs/guides/internationalization.md describes how to update this file.

import type { LocaleMessages } from "./en";

const messages: LocaleMessages = {
  common: {
    loading: "読み込み中…",
    retry: "再試行",
    dismiss: "閉じる",
    save: "保存",
    saving: "保存中…",
    cancel: "キャンセル",
    close: "閉じる",
    delete: "削除",
    edit: "編集",
    remove: "削除",
    back: "戻る",
    next: "次へ",
    previous: "前へ",
    done: "完了",
    search: "検索",
    clear: "クリア",
    copy: "コピー",
    copied: "コピーしました",
    create: "作成",
    all: "すべて",
    on: "オン",
    off: "オフ",
    today: "今日",
    todayAt: "今日 {time}",
    select: "選択",
    date: "日付",
    clearDate: "日付をクリア",
    chooseDate: "日付を選択",
    togglePassword: "パスワードの表示を切り替え",
    characters: "{length} / {max} 文字",
    listSeparator: "、",
    difficulty: {
      easy: "易しい",
      medium: "普通",
      hard: "難しい",
      unspecified: "未指定"
    },
    roles: {
      admin: "管理者",
      user: "ユーザー"
    }
  },
  language: {
    label: "言語",
    description: "PrepDeck のメニュー、ボタン、メッセージの言語です。このブラウザーに保存されます。問題の内容やメモは書かれたままの言語で表示されます。",
    loadFailed: "この言語を読み込めませんでした。もう一度お試しください。"
  },
  nav: {
    mainNavigation: "メインナビゲーション",
    breadcrumb: "パンくずリスト",
    more: "その他",
    learningTitle: "学習モード #{sequence}",
    screens: {
      dash: "統計",
      learning: "学習モード",
      practice: "練習",
      mock: "模擬試験",
      knowledgePoints: "ナレッジポイント",
      bookmarks: "ブックマーク",
      wrong: "間違えた問題",
      notes: "注釈",
      settings: "設定",
      admin: "管理"
    },
    groups: {
      overview: "概要",
      study: "学習",
      resources: "リソース",
      system: "システム"
    },
    tabs: {
      dash: "ホーム",
      practice: "練習",
      mock: "模試",
      wrong: "誤答"
    }
  },
  shell: {
    loadingExam: "この試験を読み込み中…",
    noExams: "利用できる試験がまだありません。管理者に試験の追加を依頼してください。",
    switching: "切り替える前に作業内容を保存しています…"
  },
  exams: {
    title: "試験",
    select: "試験を選択",
    selectAnExam: "試験を選択してください",
    selectCurrent: "試験を選択（現在の試験：{name}）",
    selectCurrentWithSlug: "{slug} — 試験を選択（現在の試験：{name}）",
    otherProvider: "その他"
  },
  auth: {
    expired: {
      title: "セッションの有効期限が切れました",
      body: "続けるには再度サインインしてください。保存済みの内容はすべて残っています。",
      bodyMock: "続けるには再度サインインしてください。保存済みの内容はすべて残っています。保存できなかった模擬試験の解答は、試験を再開したときに復元されます。タイマーは止まりません。",
      notNow: "後で",
      signInAgain: "再度サインイン"
    }
  },
  profile: {
    avatarOf: "{name} のアバター",
    loading: "プロフィールを読み込み中"
  },
  login: {
    mascotSignIn: "本を抱えた PrepDeck のマスコット",
    mascotDenied: "南京錠を持って申し訳なさそうにしている PrepDeck のマスコット",
    alreadyLinked: "リンク済み",
    inviteOnly: "招待制",
    conflictTitle: "別のアカウントにリンクされています",
    deniedTitle: "アクセスが許可されていません",
    conflictBody: "このアドレスは許可されていますが、すでに別の Google アカウントにリンクされています。このアカウントでサインインすると他の人のデータを引き継ぐことになります。管理者に「許可ユーザー」から Google のリンクをリセットしてもらってから、もう一度サインインしてください。",
    deniedBody: "サインインには成功しましたが、このアカウントは PrepDeck の許可リストに含まれていません。管理者に招待してもらってから、もう一度お試しください。",
    tryDifferentAccount: "別のアカウントを試す",
    welcome: "おかえりなさい！",
    tagline: "すべての練習問題をひとつのデッキに。サインインして練習を始めるか、前回の続きから再開しましょう。",
    signedOut: "サインアウトしました。もう一度サインインすると前回の続きから再開できます。",
    oauthError: "Google でのサインインが完了しませんでした。接続を確認してもう一度お試しください。何も送信されていません。",
    verification: {
      failed: "人間であることを確認できなかったか、確認の有効期限が切れました。もう一度確認を完了してからサインインしてください。",
      unavailable: "人間確認が現在利用できないため、サインインを開始できませんでした。あなたの確認に問題はありません。数分後にもう一度お試しください。",
      misconfigured: "このサーバーの人間確認の設定に問題があるため、サインインできません。管理者に連絡してください。"
    },
    reverified: "確認が完了しました。サインインできます。",
    signingIn: "サインイン中…",
    signInWithGoogle: "Google でサインイン",
    invitationOnly: "招待制です。管理者が承認した Google アカウントを使うか、管理者にアクセスを依頼してください。"
  },
  legal: {
    privacy: "プライバシーポリシー",
    terms: "利用規約",
    home: "PrepDeck ホーム",
    back: "PrepDeck に戻る",
    englishOnly: "この文書は英語版のみです。英語の本文が適用されます。"
  },
  turnstile: {
    label: "人間確認",
    loading: "確認を読み込み中…",
    expired: "確認の有効期限が切れました。更新しています…",
    failed: "確認が完了しませんでした。",
    unavailable: "確認を読み込めませんでした。接続を確認してください。",
    configFailed: "人間確認が必要かどうかを確認できませんでした。接続を確認してください。",
    tryAgain: "もう一度試す"
  },
  settings: {
    groups: {
      account: "アカウント",
      study: "学習",
      studyDesc: "PrepDeck の見た目、マーク、リマインダーの設定です。",
      integrations: "AI と連携",
      integrationsDesc: "自分のキーで、自分のクライアントを。"
    },
    nav: {
      sections: "設定のセクション",
      profile: "プロフィール",
      session: "サインアウト",
      appearance: "外観",
      language: "言語",
      marks: "マークの名前",
      notes: "共有メモ",
      timezone: "タイムゾーン",
      email: "毎日のメール",
      ai: "AI 解説",
      mcp: "MCP アクセス",
      aiReady: "準備完了",
      aiLocked: "ロック中",
      aiNotSet: "未設定"
    },
    profile: {
      yourProfile: "あなたのプロフィール",
      signedInWithGoogle: "Google でサインイン中",
      uploading: "アップロード中…",
      uploadAvatar: "アバターをアップロード",
      avatarUploadFailed: "この画像をアップロードできませんでした。",
      displayName: "表示名",
      displayNameDesc: "変更するまでは Google の名前が使われます。",
      displayNameEmpty: "保存するには表示名を入力してください。",
      nameSaveFailed: "表示名を保存できませんでした。もう一度お試しください。"
    },
    session: {
      title: "すべての端末からサインアウト",
      desc: "すべての端末とブラウザーのセッションを終了します。MCP トークンと連携アプリは別管理なので、下で取り消してください。",
      removeKey: "このブラウザーに保存した AI キーも削除する",
      signOut: "サインアウト"
    },
    appearance: {
      title: "外観",
      desc: "このブラウザーに保存され、すぐに全体へ反映されます。"
    },
    themes: {
      light: {
        name: "ライト",
        hint: "既定"
      },
      cream: {
        name: "クリーム",
        hint: "やわらか"
      },
      sage: {
        name: "セージ",
        hint: "落ち着き"
      },
      clay: {
        name: "クレイ",
        hint: "あたたか"
      },
      dusk: {
        name: "ダスク",
        hint: "暗め"
      }
    },
    marks: {
      title: "マークの名前",
      desc: "各ハイライトの意味を名前で表しましょう。名前はどこでも使われ、色はテーマに合わせて変わります。",
      names: {
        hl1: "1 つ目のマーク",
        hl2: "2 つ目のマーク",
        hl3: "3 つ目のマーク"
      },
      sample: "<hl1>ゲートウェイエンドポイント</hl1>は S3 のトラフィックを VPC 内に保ち、<hl2>インターフェイスエンドポイント</hl2>は PrivateLink を使って<hl3>時間単位で課金</hl3>されます。"
    },
    sharedNotes: {
      title: "他のユーザーが共有したメモを表示",
      desc: "自分のメモは非公開・共有にかかわらず常に表示されます。"
    },
    timezone: {
      title: "タイムゾーン",
      desc: "統計はこのタイムゾーンで日と週を数え、毎日のメールもこのタイムゾーンの配信時刻に届きます。",
      now: "{offset} · 現在 {time}",
      saveFailed: "タイムゾーンを保存できませんでした。もう一度お試しください。"
    },
    email: {
      title: "毎日の復習メール",
      desc: "練習問題をいくつかメールでお届けします。解答は含まれません。",
      next: "次回：{when}",
      todayAt: "今日 {time}",
      tomorrowAt: "明日 {time}",
      questionsPerEmail: "1 通あたりの問題数",
      deliveryTime: "配信時刻",
      inYourZone: "あなたのタイムゾーン（{zone}）での時刻です。",
      source: "問題の出題元",
      sources: {
        wrong: {
          title: "誤答ノート",
          body: "以前に間違えた問題。"
        },
        bm: {
          title: "ブックマーク",
          body: "後で見るために保存した問題。"
        },
        new: {
          title: "未解答",
          body: "まだ解いていない問題。"
        }
      }
    },
    ai: {
      customModel: "カスタムモデル ID…",
      errors: {
        noKey: "先に API キーを入力してください。",
        noPassphrase: "キーを暗号化するパスフレーズを設定してください。",
        saveFailed: "暗号化したキーを保存できませんでした。",
        unlockFailed: "パスフレーズが違うか、保存されたキーがありません。"
      },
      storage: {
        memory: "メモリのみ（既定）",
        memoryShort: "メモリのみ",
        memoryBody: "再読み込みやタブを閉じた時点で消去されます。ディスクには保存されません。",
        encrypted: "このブラウザーに暗号化して保存",
        encryptedBody: "AES-GCM の暗号文として IndexedDB に保存し、アクセスのたびにパスフレーズで解除します。"
      },
      status: {
        loaded: "このセッションでキーを読み込み済み",
        locked: "保存したキーのロックを解除",
        changing: "キーの設定を変更",
        settingUp: "キーを設定中",
        notSetUp: "未設定"
      },
      manage: "管理",
      provider: "プロバイダー",
      model: "モデル",
      keyStorage: "キーの保存方法",
      passphrase: "パスフレーズ",
      choosePassphrase: "パスフレーズを設定",
      passphraseHint: "AES-GCM で暗号化し、このブラウザーだけに保存します。パスフレーズは復元できません。忘れると保存したキーは使えなくなります。",
      unlock: "ロック解除",
      useDifferentKey: "別のキーを使う",
      forgetKey: "保存したキーを削除",
      stepConfigure: "設定",
      stepKey: "キー",
      stepOf: "ステップ {step} / {total}",
      exactModel: "正確なモデル ID",
      continue: "続ける",
      pasteKey: "{provider} のキーを貼り付け",
      pasteKeyDesc: "このアプリのサーバーにのみ送信され、リクエストごとに 1 回中継されるだけで保存されません。",
      apiKey: "API キー",
      replaceKey: "API キーを置き換え",
      saveEncrypt: "保存して暗号化",
      loadKey: "キーを読み込む",
      clearKey: "読み込んだキーを消去",
      note: "キーはこのアプリ自身のサーバーにのみ送信され、1 回のリクエストごとに {provider} へ中継されるだけで保存されることはありません。"
    },
    mcp: {
      title: "MCP アクセス",
      desc: "AI クライアント（Claude、ChatGPT など）を MCP 経由で PrepDeck の学習データに接続するための個人用アクセストークンです。各トークンはあなたとして動作し、いつでも取り消せます。",
      namePlaceholder: "例：claude-desktop"
    },
    connections: {
      title: "連携中のアプリ",
      desc: "トークンの代わりに Google でサインインしてアクセスを承認した AI クライアントです。それぞれ、接続を解除するまで承認した権限であなたとして動作します。"
    }
  },
  mcp: {
    tokens: {
      created: "{when} に作成",
      neverUsed: "未使用",
      lastUsed: "最終使用：{when}",
      expired: "{when} に失効",
      expires: "{when} に失効予定",
      neverExpires: "無期限",
      loadFailed: "トークンを読み込めませんでした。",
      nameRequired: "名前は必須です。",
      createFailed: "このトークンを作成できませんでした。",
      revokeConfirm: "「{name}」を取り消しますか？このトークンを使っているものはすぐに動作しなくなります。",
      revokeFailed: "このトークンを取り消せませんでした。",
      rotateConfirm: "「{name}」をローテーションしますか？現在のトークンはすぐに無効になり、新しいトークンに置き換わります。",
      rotateFailed: "このトークンをローテーションできませんでした。",
      tokenCopied: "トークンをコピーしました。",
      promptCopied: "セットアッププロンプトをコピーしました。",
      setupIntro: "セットアッププロンプトを AI チャットボットにコピーして PrepDeck に接続します。求められたら、クライアントでトークンを安全に入力してください。",
      copySetupPrompt: "セットアッププロンプトをコピー",
      createButton: "+ トークンを作成",
      name: "名前",
      namePlaceholder: "例：local-cli",
      expiration: "有効期限",
      expiry: {
        never: "無期限",
        days_other: "{count} 日",
        year: "1 年"
      },
      creating: "作成中…",
      create: "トークンを作成",
      copyNow: "今すぐ「{name}」をコピーしてください。再表示されません",
      newToken: "新しい MCP トークン",
      hide: "隠す",
      show: "表示",
      copySetupPromptWithToken: "トークン付きのセットアッププロンプトをコピー",
      includesSecret: "秘密情報を含みます。貼り付けると、選んだ AI サービスとトークンを共有することになります。",
      copyFailedToken: "クリップボードにコピーできませんでした。下のトークンを選択してコピーしてください。",
      copyFailedPrompt: "クリップボードにコピーできませんでした。下のセットアッププロンプトを選択してコピーしてください。",
      copyManuallyToken: "手動でコピーするトークン",
      copyManuallyPrompt: "手動でコピーするセットアッププロンプト",
      empty: "トークンはまだありません。",
      status: {
        active: "有効",
        revoked: "取り消し済み",
        expired: "失効"
      },
      rotate: "ローテーション",
      revoke: "取り消す",
      rotating: "「{name}」をローテーションすると、現在のトークンはすぐに無効になり、新しいトークンが発行されます。",
      completeCheck: "確認を完了してからローテーションしてください。",
      rotateToken: "トークンをローテーション"
    },
    connections: {
      readWrite: "読み取りと書き込み",
      readOnly: "読み取りのみ",
      connected: "{when} に接続",
      idle: "長期間使われていません。アプリから再接続してください",
      loadFailed: "連携中のアプリを読み込めませんでした。",
      thisApp: "このアプリ",
      disconnectConfirm: "{name} の接続を解除しますか？すぐに動作しなくなり、再びアクセスするには接続し直す必要があります。",
      disconnectFailed: "このアプリの接続を解除できませんでした。",
      disabled: "このサーバーでは新しい接続が無効になっています。既存の接続も再び有効になるまで動作しません。",
      empty: "連携中のアプリはありません。",
      unnamed: "名前のないアプリ",
      statusConnected: "接続中",
      statusExpired: "失効",
      disconnect: "接続を解除"
    },
    scopes: {
      userRead: {
        label: "学習データの読み取り",
        description: "試験、問題、解答履歴、統計、注釈、ナレッジポイント。"
      },
      userWrite: {
        label: "学習記録の作成とメモの編集",
        description: "練習の開始と解答、学習モードの位置の設定、ナレッジポイントの作成・編集・削除。"
      },
      adminRead: {
        label: "管理者として問題バンクを読み取る",
        description: "すべての試験と問題、品質チェックのレポート、統計、エクスポート、インポートのプレビュー。"
      },
      adminWrite: {
        label: "共有の問題バンクを変更する",
        description: "すべてのユーザーを対象に、問題と試験の作成・更新・アーカイブ・削除、インポートの実行、タグカタログの編集を行います。"
      }
    },
    connect: {
      errors: {
        invalid_client: {
          title: "不明なアプリ",
          body: "ここへ移動させたアプリを PrepDeck が認識できないため、何も接続されていません。アプリに戻ってもう一度接続してください。繰り返し発生する場合、そのアプリは PrepDeck のサインインに対応していない可能性があります。"
        },
        invalid_redirect_uri: {
          title: "アプリに戻れません",
          body: "アプリが登録されていないアドレスへの戻りを要求したため、PrepDeck は何も表示せずに停止しました。何も接続されていません。アプリから再接続してください。"
        },
        invalid_request: {
          title: "無効な接続リクエスト",
          body: "アプリのリクエストの形式が正しくないため、何も接続されていません。アプリから再接続してください。"
        },
        unavailable: {
          title: "アプリの接続は利用できません",
          body: "この PrepDeck サーバーは MCP アプリからのサインインを受け付けていません。アプリが対応していれば、代わりに「設定 → MCP アクセス」の個人用アクセストークンを使ってください。"
        }
      },
      loadFailed: "PrepDeck はこの接続リクエストを読み込めませんでした。ページを再読み込みするか、アプリから再接続してください。",
      decideFailed: "処理できませんでした。接続を確認してもう一度お試しください。",
      ended: "このリクエストは終了しました",
      connected: "接続しました",
      notConnected: "接続されていません",
      returning: "アプリに戻っています。何も起きない場合は、このタブを閉じてアプリで続けてください。",
      unnamedApp: "名前のないアプリ",
      title: "{app} を PrepDeck に接続しますか？",
      adminRequired: "管理者のアクセス権が必要です",
      actsAsYou: "接続を解除するまで、下記のアクセス権であなたとして {server} を利用します。",
      adminOnly: "{app} は PrepDeck Admin MCP へのアクセスを求めていますが、承認できるのは有効な管理者だけです。接続せずにアプリへ戻ってください。",
      app: "アプリ",
      unverified: "未確認",
      unverifiedTitle: "アプリの自己申告です。PrepDeck は発行元を確認していません。",
      clientId: "クライアント ID {id}",
      returnsTo: "戻り先",
      server: "サーバー",
      administrativeAccess: "管理者アクセス",
      account: "アカウント",
      ableTo: "このアプリでできること",
      trust: "信頼できるアプリだけを接続してください。いつでも{place}から接続を解除できます。PrepDeck からサインアウトしても接続は解除されません。",
      placeAdmin: "「管理 → MCP トークン」",
      placeSettings: "「設定 → MCP アクセス」",
      connecting: "接続中…",
      allow: "アクセスを許可",
      returningShort: "戻っています…",
      returnToApp: "アプリに戻る"
    }
  },
  stats: {
    loading: "統計を読み込み中…",
    unavailable: "利用できません",
    unavailableRetry: "利用できません。再試行してこのデータを読み込んでください。",
    noExam: "試験が選択されていません",
    noExamBody: "試験の切り替えメニューから試験を選ぶと統計が表示されます。",
    loadFailed: "{what}を読み込めませんでした。このページのほかの内容には影響ありません。",
    failures: {
      statistics: "統計",
      activity: "学習アクティビティ",
      plan: "学習計画"
    },
    passed: "合格",
    belowLine: "合格ライン未満",
    zoneTime: "{city}時間",
    signedPoints: "{sign}{count} ポイント",
    duration: {
      minutes: "{minutes}分",
      hours: "{hours}時間",
      hoursMinutes: "{hours}時間{minutes}分"
    },
    header: {
      greeting: "こんにちは、{name} さん",
      greetingAnonymous: "こんにちは",
      tracking: "今日の <exam>{name}</exam> の準備状況です。",
      chooseExam: "試験を選ぶと準備状況が表示されます。",
      continue: "練習を続ける",
      setUp: "練習を設定"
    },
    countdown: {
      daysLeft_other: "試験 {date} · あと {count} 日",
      today: "試験 {date} · 今日",
      passed: "試験 {date} · 終了"
    },
    plan: {
      title: "学習計画",
      loadFirst: "編集する前に学習計画を読み込んでください。",
      unavailable: "学習計画を利用できません",
      loading: "学習計画を読み込み中…",
      changeLabel: "{countdown}。学習計画を変更します。",
      setDate: "試験日を設定",
      saveFailed: "学習計画を保存できませんでした。もう一度お試しください。",
      forExam: "対象：{exam}。",
      forActive: "対象：現在の試験。",
      optional: "どちらも任意です。項目を空にすると削除されます。",
      examDate: "試験日",
      invalidDate: "正しい日付を入力してください。",
      countdownHint: "日単位でカウントダウンします（{zone}）。",
      weeklyGoal: "週の学習目標（時間）",
      goalRange: "{min}～{max} 時間で入力してください。",
      goalHint: "記録された学習時間（月曜～日曜）で測ります。"
    },
    readiness: {
      title: "試験準備度",
      noBank: "この試験にはまだ問題がないため、測定できるものがありません。",
      noAttempts: "問題に解答すると、ここに準備度の推定が表示されます。",
      smallSample: "準備度の算出には少なくとも {min} 問の解答が必要です（現在 {answered} 問）。それまでは問題バンクのカバー率だけを表示します。",
      thisExam: "この試験",
      noPassMark: "{subject} のうち、これまでに見た {pct}% の問題に基づく難易度加重の推定です。この試験には合格ラインが設定されていないため、比較の基準はありません。",
      above_other: "合格ライン {pass}% を {count} ポイント上回っています。下の弱点タグが落ちないようにしましょう。",
      below_other: "合格ライン {pass}% まであと {count} ポイントです。差は下の弱点タグにあります。",
      ringReady: "準備",
      ringCovered: "カバー済み",
      ringAriaReady: "準備度",
      ringValue: "準備度 {pct}%",
      ringValuePass: "準備度 {pct}%（合格ライン {pass}%）",
      ringUnavailable: "準備度はまだ算出できません。問題バンクのカバー率は {pct}% です。",
      method: "難易度加重方式 v{version}、{questions} 問・{answers} 回の解答に基づきます。試験の得点予測ではありません。",
      covered: "問題バンクのカバー率",
      coverageValue: "{seen} / {total} · {pct}%",
      emptyBank: "この問題バンクにはまだ問題がありません",
      coverageAria: "問題バンクのカバー率 {pct}%",
      noWeakTags: "判断できるだけの解答があり、かつ練習できる問題が残っているタグはありません。",
      practises: "練習対象：{tags}",
      practiceWeak: "弱点タグを練習",
      startMock: "模擬試験を始める"
    },
    first: {
      kicker: "はじめよう",
      title: "最初の問題に解答しよう",
      titleCount: "最初の {count} 問に解答しよう",
      about: "約 {count} 分。まだ見ていない問題から出題します。",
      noneLeft: "出題できる未解答の問題がありません。",
      fillIn: "解答が集まると、正答率、推移グラフ、最も弱い分野が表示されます。",
      start: "問題を始める",
      startCount: "{count} 問を始める",
      learn: "まず解答付きで読む"
    },
    answered: {
      label: "解答済み",
      suffix: "/ {total}",
      footer: "{days} 日で +{added} 問 · 未見 {unseen} 問",
      progress: "問題バンクの {pct}% に解答済み"
    },
    accuracy: {
      label: "正答率",
      notMeasured: "未測定",
      notMeasuredPass: "未測定 · 合格ライン {pass}%",
      answersNoPass_other: "{count} 回の解答 · 合格ライン未設定",
      answersVsPass_other: "{count} 回の解答 · 合格ライン {pass}%"
    },
    wrongBook: {
      label: "誤答ノート",
      suffix: "件",
      empty: "まだ保存されていません",
      footer: "2 回以上間違えた問題 {repeated} 件 · 直近 7 日で {recent} 件",
      strip: "未習得の問題 {saved} 件（うち {repeated} 件は 2 回以上間違えています）"
    },
    bestMock: {
      label: "模試の最高点",
      footer_other: "{date} · {count} 回受験",
      empty: "完了した模擬試験はまだありません",
      bars: "直近 {count} 回の模擬試験の得点：{scores}"
    },
    focus: {
      title: "重点的に取り組む分野",
      status: {
        weakest: "最も弱い",
        belowLine: "ライン未満",
        onTrack: "順調",
        notMeasured: "未測定 · {count} 回の解答が必要"
      },
      mix: {
        mostlyHard: "難しい問題が中心",
        mediumHeavy: "普通の問題が中心",
        mostlyEasy: "易しい問題が中心",
        mixed: "難易度は混在"
      },
      wrong: "誤答 {count} 問",
      unseen: "未見 {count} 問",
      nothingLeft: "練習できる問題は残っていません",
      notRanked: "まだ順位はありません。タグは {count} 回の解答で測定されます。それまでは練習できる問題が多いタグから並びます。",
      ranked: "弱いタグから順に表示（難問を重み付け）",
      rankedPass: "弱いタグから順に表示（難問を重み付け、合格ライン {pass}% と比較）",
      showTop: "上位のタグだけ表示",
      viewAll: "{count} 個のタグをすべて表示",
      empty: "この問題バンクにはタグ付きの問題がまだないため、順位を付けられません。",
      meterUnmeasured: "{tag}：解答が少なく正答率を測定できません",
      meter: "{tag}：{count} 回の解答で正答率 {pct}%",
      allPractisedTitle: "{tag} の問題はすべて解答済みで、誤答ノートにも残っていません。",
      allPractised: "すべて練習済み",
      practice: "{count} 問を練習"
    },
    trend: {
      title: "正答率の推移",
      loading: "正答率の推移を読み込み中…",
      summary_other: "直近 {count} 日の活動日の正答率は、{fromDay} の {from}% から {toDay} の {to}% です。",
      noPassMark: "この試験には合格ラインが設定されていません。",
      passLineIs: "合格ラインは {pass}% です。",
      empty: "完了した解答がまだないため、正答率の推移はありません。",
      subtitle_other: "直近 {count} 日の活動日（日付は{zone}で集計）",
      needsAnswer: "少なくとも 1 回の解答が必要です",
      passLine: "合格ライン",
      completeSession: "練習または模擬試験を 1 回終えると、ここに推移が表示されます。",
      latest: "最新 {pct}%",
      latestNoPass: "この試験には合格ラインがありません",
      aboveLine: "ラインを上回っています",
      belowLine: "ラインを下回っています",
      caption: "活動日ごとの正答率"
    },
    studyTime: {
      title: "学習時間",
      loading: "学習時間を読み込み中…",
      summaryEmpty: "今週完了した学習セッションはありません。",
      summary_other: "今週は {count} 回のセッションで {time} の学習時間が記録されています。",
      summaryGoal: "週の目標は {goal} です。",
      summaryNoGoal: "週の目標は設定されていません。",
      summaryGoalUnavailable: "週の目標を利用できません。",
      summaryMissing_other: "{count} 回のセッションで時間が記録されていません。",
      ofGoal: "{time} / 週の目標 {goal}",
      recorded: "今週の記録 {time}",
      goalUnavailable: "週の目標を利用できません",
      goalLoading: "週の目標を読み込み中…",
      goalPct: "目標の {pct}%",
      setGoal: "週の目標を設定",
      sessions_other: "{count} セッション",
      noDurations: "セッション時間の記録がありません",
      average: "平均 {time}",
      longest: "最長 {day} · {time}",
      footnote: "記録されたセッション時間（{zone}の月曜～日曜）。",
      footnoteMissing_other: "{count} 回のセッションは時間が記録されておらず「?」と表示されます。",
      caption: "今週の日別の学習時間"
    },
    table: {
      show: "数値を表示",
      empty: "データはまだありません。",
      day: "日",
      date: "日付",
      answers: "解答",
      correct: "正解",
      sessions: "セッション",
      recordedTime: "記録時間"
    },
    heatmap: {
      day_other: "{date}：{count} 問",
      noPractice: "{date}：練習なし",
      less: "少",
      more: "多"
    },
    detail: {
      summary: "詳細：難易度、模擬試験の履歴、長期の活動",
      byDifficulty: "難易度別",
      difficultyProgress: "{difficulty}：{pct}%",
      noAttempts: "まだ解答がありません。",
      mockHistory: "模擬試験の履歴",
      completed: "完了日",
      score: "得点",
      questions: "問題数",
      result: "結果",
      noMocks: "完了した模擬試験はまだありません。",
      activity: "学習アクティビティ",
      activitySummary: "直近 {days} 日 · 活動日 {active} 日 · {sessions} セッション中 {withDuration} 件で時間を記録 · 平均 {minutes} 分"
    }
  },
  study: {
    question: "問題",
    questionN: "問題 {n}",
    ofTotal: "/ {total}",
    yourAnswer: "あなたの解答",
    tabs: {
      explanation: "解説",
      notes: "メモ",
      related: "関連",
      history: "履歴"
    },
    optionStatus: {
      yoursCorrect: "あなたの解答 · 正解",
      correct: "正解",
      yoursIncorrect: "あなたの解答 · 不正解"
    },
    gate: {
      loadFailed: "この問題を読み込めませんでした。もう一度お試しください。",
      loading: "問題を読み込み中…",
      retry: "問題を再読み込み",
      refresh: "試験を更新"
    },
    structured: {
      orderLegend: "各項目を順番に選んでください",
      matchLegend: "各項目に対応するものを選んでください",
      position: "{n} 番目",
      match: "{id} の対応",
      select: "選択…",
      correctResponse: "正しい解答：{response}"
    },
    bookmark: "ブックマーク",
    tags: "タグ",
    review: "復習",
    showMore: "もっと見る",
    showLess: "閉じる",
    correct: "正解",
    incorrect: "不正解",
    officialExplanation: "公式解説",
    studied: {
      label: "学習済み",
      markStudied: "学習済みにする",
      markUnstudied: "未学習に戻す"
    },
    copyPrompt: {
      label: "プロンプトとしてコピー",
      title: "問題と解答を Markdown のプロンプトとしてコピー",
      failed: "コピーに失敗しました",
      copiedAnnounce: "Markdown のプロンプトをクリップボードにコピーしました。",
      failedAnnounce: "Markdown のプロンプトをコピーできませんでした。"
    },
    underReview: {
      badge: "レビュー中",
      notice: "この問題は現在レビュー中で、内容に異論や不確かな点が含まれている可能性があります。"
    },
    options: {
      single: "解答の選択肢（1 つ選択）",
      multiple: "解答の選択肢（当てはまるものをすべて選択）",
      review: "解答の選択肢"
    },
    ai: {
      title: "AI 解説",
      cached: "キャッシュ済み",
      generated: "生成済み",
      notCached: "未キャッシュ",
      regenerate: "再生成",
      relaying: "{provider} に中継中…",
      checking: "共有キャッシュを確認中…",
      alreadyExplained: "<model>{name}</model> による解説があります",
      showIt: "表示する",
      noCached: "{provider} · {model} のキャッシュされた解説はまだありません。",
      generate: "解説を生成",
      noKey: "API キーが読み込まれていません。新しい解説を生成するには設定で追加してください。",
      addKey: "設定で API キーを追加",
      unlockToGenerate: "保存したキーのロックを解除して生成",
      unlocking: "ロック解除中…"
    },
    history: {
      emptyTitle: "まだ解答がありません",
      emptyBody: "練習や模擬試験でまだ解答していません。",
      mock: "模試",
      practice: "練習",
      answered: "解答 <answer>{value}</answer>"
    },
    revision: {
      title: "解答が改訂されました",
      historical: "この結果は解答時点の正解に基づいています。過去の得点は変わりません。",
      gradedKey: "採点時の正解：{key}。",
      legacy: "この古い解答では、当時の正解が記録されていません。"
    },
    filters: {
      all: {
        label: "すべての状況",
        desc: "学習済み・未学習の両方"
      },
      unstudied: {
        label: "未学習のみ",
        desc: "学習モードで表示も解答もされていない、または未学習に戻した問題"
      },
      studied: {
        label: "学習済みのみ",
        desc: "学習モードで表示された、または練習・模試で解答した問題"
      }
    }
  },
  notes: {
    emptyError: "問題のメモを空にすることはできません。",
    editNote: "メモを編集",
    saveFailed: "保存できませんでした。下書きは残っています。もう一度お試しください。",
    placeholder: "この問題のメモを書く…",
    forQuestion: "この問題のメモ",
    visibilityLabel: "メモの公開範囲",
    save: "メモを保存",
    visibility: {
      private: "非公開",
      shared: "共有",
      privateLabel: "非公開",
      sharedLabel: "共有"
    }
  },
  setup: {
    questions_other: "{count} 問",
    underReview: {
      title: "レビュー中の問題",
      desc_other: "この試験の {count} 問はまだレビュー中で、内容に異論や不確かな点が含まれている可能性があります。",
      include: "含める",
      includeDesc: "出題され、それぞれレビュー中と表示されます",
      skip: "除外",
      skipDesc: "このセッションから除外します"
    },
    studyStatus: {
      title: "学習状況",
      desc: "「学習済み」は学習モードで表示された、または練習・模試で解答したことを指し、習得したという意味ではありません。",
      unavailable: "学習状況を読み込めなかったため、問題が未学習と表示される場合があります。試験を更新してもう一度お試しください。"
    },
    moreOptions: {
      title: "その他のオプション",
      desc: "任意です。ほとんどの場合は既定のままで大丈夫です。",
      hide: "閉じる",
      customize: "カスタマイズ"
    },
    difficulty: {
      label: "難易度",
      desc: "問題の難易度で絞り込みます。",
      any: "指定なし"
    },
    domains: {
      title: "分野",
      desc: "特定の分野を選ばない限り、すべて含まれます。",
      none: "この試験にはまだ分野がありません。",
      searchPlaceholder: "{count} 個の分野を検索",
      search: "分野を検索",
      clearSearch: "検索をクリア",
      filters: "分野の絞り込み",
      noMatch: "「{query}」に一致する分野はありません。",
      showFewer: "表示を減らす",
      showAll: "{count} 個の分野をすべて表示",
      selectResults: "結果をすべて選択（{count}）",
      selected: "{count} 件選択中",
      selectResultsHint: "「結果をすべて選択」は現在選択している分野を置き換えます。"
    },
    summary: {
      title: "セッションの概要",
      matches_other: "{count} 問が条件に一致",
      source: "出題元",
      questions: "問題数",
      estimatedTime: "所要時間の目安",
      minutes: "約 {count} 分",
      skipped: "除外",
      included: "含む",
      start: "開始"
    }
  },
  practice: {
    setup: {
      title: "練習を作成",
      intro: "時間制限なし。出題元と問題数を選んで開始します。その他はすべて任意です。",
      source: "出題元",
      sourceDesc: "練習する問題を選びます。",
      count: "問題数",
      countDesc: "5～40 問を選びます（1 問あたり約 {minutes} 分）。",
      countPresets: "問題数のプリセット",
      feedback: "解答のフィードバック",
      feedbackDesc: "解答と解説を表示するタイミングを選びます。",
      hiddenNote: "解答中は注釈とメモが非表示になり、採点されるとすぐに再表示されます。"
    },
    shortcuts: {
      title: "キーボードショートカット",
      selectOption: "選択肢を選ぶ",
      selectLetter: "文字で選ぶ",
      check: "解答を確認 / 次の問題"
    },
    live: {
      correctCount: "正解 {count}",
      incorrectCount: "不正解 {count}",
      noTimer: "時間制限なし · 1 問ごとにフィードバック",
      checkCount: "解答を確認（{chosen}/{need}）",
      check: "解答を確認",
      finish: "終了",
      next: "次の問題",
      end: "終了",
      endSession: "セッションを終了",
      incorrectAdded: "不正解 — 誤答ノートに追加しました",
      correctAnswer: "正解：{answer}。",
      explanationBelow: "解説は下に表示されています。",
      explanationRight: "解説は右側に表示されています。",
      lockedTitle: "解説とメモはロックされています",
      lockedBody: "解答を確認するとすぐに表示されます。答えが先にわからないようにするためです。"
    },
    sources: {
      all: {
        label: "すべての問題",
        desc: "この試験の問題バンク全体"
      },
      new: {
        label: "未解答",
        desc: "一度も解答していない問題"
      },
      focus: {
        label: "未解答 + 誤答",
        desc: "新しい問題と、まだ習得していない誤答"
      },
      wrong: {
        label: "誤答ノート",
        desc: "まだ習得していない誤答"
      },
      bm: {
        label: "ブックマーク済み",
        desc: "後で見るために保存した問題"
      }
    },
    emptySource: {
      all: {
        title: "この試験にはまだ問題がありません",
        body: "問題が問題バンクに追加されると、ここに表示されます。"
      },
      new: {
        title: "すべての問題に解答しました",
        body: "この問題バンクには未解答の問題がもうありません。"
      },
      focus: {
        title: "新しい問題も未習得の問題も残っていません",
        body: "すべての問題に解答し、誤答ノートも空になっています。"
      },
      wrong: {
        title: "誤答ノートは空です",
        body: "練習や模擬試験で間違えた問題は、習得するまでここに保存されます。"
      },
      bm: {
        title: "ブックマークした問題はまだありません",
        body: "学習中に問題をブックマークすると、ここに保存されます。"
      }
    },
    feedback: {
      immediate: {
        label: "1 問ごと",
        desc: "確認するたびに解答と解説を表示"
      },
      end: {
        label: "最後にまとめて",
        desc: "すべて解答してから見直す"
      }
    },
    difficulty: {
      any: "難易度指定なし",
      easy: "易しいのみ",
      medium: "普通のみ",
      hard: "難しいのみ"
    },
    empty: {
      practiceUnattempted: "未解答の問題を練習（{count}）",
      practiceAll: "すべての問題を練習（{count}）",
      allStudiedTitle: "条件に合う問題はすべて学習済みです",
      noneStudiedTitle: "条件に合う問題をまだ学習していません",
      allStudiedBody: "ほかの条件に合う問題は、すべて学習モードで表示されたか解答済みです。学習モードで未学習に戻すと、ここで再び練習できます。",
      noneStudiedBody: "ほかの条件に合う問題は、まだ学習モードで表示も解答もされていません。",
      practiceMatching_other: "条件に合う {count} 問をすべて練習",
      noMatchTitle: "条件に一致する問題がありません",
      noMatchBody_other: "「{source}」には {count} 問ありますが、選択した分野・難易度・学習状況・レビューの条件に合う問題がありません。",
      clearFilters: "分野・難易度・学習状況の条件をクリア"
    },
    summary: {
      reviewSkipped: "レビュー中を除外",
      reviewIncluded: "レビュー中を含む",
      feedback: {
        immediate: "1 問ごとにフィードバック",
        end: "最後にまとめてフィードバック"
      }
    }
  },
  learning: {
    live: {
      title: "問題 #{sequence}",
      position: "{n} / {total}",
      exit: "終了",
      progress: "学習の進み具合",
      jumpPlaceholder: "# へ移動",
      jumpLabel: "問題番号へ移動",
      go: "移動",
      last: "最後の問題",
      accepted: "正解として認める解答"
    },
    setup: {
      title: "問題バンクを順番に学ぶ",
      intro: "解答を表示し、採点はしません。開始位置を選び、分野で絞り込んで読み進めましょう。",
      allStudiedBody: "ほかの条件に合う問題は、すべて学習モードで表示されたか解答済みです。学習中に未学習に戻すと、ここに再び表示されます。",
      learnMatching_other: "条件に合う {count} 問をすべて学習",
      noMatchBody: "選択した分野・難易度・学習状況・レビューの条件に合う問題がこの試験にはありません。",
      clearAll: "すべての条件をクリア",
      resumeTitle: "前回の続きから再開",
      resumeBody: "前回は問題 #{sequence} で中断しました。",
      resume: "再開",
      start: "開始位置",
      startDesc: "ここから番号順に表示します。",
      startFrom: "開始する問題 #",
      startFromRange: "開始する問題 #（1～{max}）",
      numberingGaps: "番号は位置ではなく固定の問題 ID です。1～{max} のうち {count} 個の番号が条件に一致します。存在しない番号を指定すると、次の番号から始まります。",
      startsAt: "開始",
      begin: "学習を始める",
      note: "各問題では正解、あなたの解答履歴、解説、メモがすぐに表示されます。採点はされず、誤答ノートにも追加されません。表示した問題は学習済みになり、未学習に戻すこともできます。"
    }
  },
  questionTypes: {
    chooseN: "{count} つ選択",
    single: "単一選択",
    trueFalse: "正誤",
    ordering: "並べ替え",
    matching: "組み合わせ",
    fillBlank: "穴埋め"
  },
  pager: {
    label: "問題のページ",
    page: "{current} / {pages} ページ",
    goTo: "ページへ移動",
    invalid: "1～{pages} の整数でページ番号を入力してください。"
  },
  lists: {
    wrongTitle: "誤答ノート",
    practiceThese: "この {count} 問を練習",
    saved: "保存済み",
    wrongTimes: "{count} 回不正解 · {date}",
    removeBookmark: "ブックマークを外す",
    markMastered: "習得済みにする",
    emptyBookmarksTitle: "まだ保存されていません",
    emptyBookmarksBody: "練習中に問題をブックマークすると、ここに表示されます。",
    emptyWrongTitle: "誤答ノートは空です",
    emptyWrongBody: "間違えた問題はすべて習得しました。お見事です。"
  },
  tagFilter: {
    label: "タグで絞り込む",
    resultOf_other: "{count} 問中 {n} 問",
    tagsSelected_other: "{count} 個のタグを選択中",
    allTags: "すべてのタグ",
    clear: "条件をクリア",
    searchPlaceholder: "タグを検索…",
    search: "タグを検索",
    noOtherMatch: "「{query}」に一致する他のタグはありません。",
    noMatch: "「{query}」に一致するタグはありません。",
    showMore: "あと {count} 個表示",
    hint: "複数のタグを選ぶと、いずれかのタグが付いた問題が表示されます。"
  },
  kp: {
    untitled: "無題のナレッジポイント",
    ungrouped: "グループなし",
    groups: "グループ",
    tags: "タグ",
    unlink: "リンクを解除",
    reviewInLearning: "学習モードで復習",
    reviewInLearningTitle: "学習モードで開いて復習します。解答は記録されません。",
    list: {
      sorts: {
        updated: "最終更新",
        title: "タイトル",
        created: "作成日",
        custom: "カスタム順"
      },
      justNow: "たった今",
      updated: "{when}に更新",
      linkedQuestions_other: "関連問題 {count} 件",
      noLinkedQuestions: "関連問題なし",
      screenshots_other: "スクリーンショット {count} 枚",
      diagrams_other: "図 {count} 件",
      note: "ノート",
      reorder: "矢印キーまたはドラッグで「{title}」を並べ替え",
      moveUp: "「{title}」を上へ移動",
      moveDown: "「{title}」を下へ移動",
      acrossExams: "すべての試験で利用可能",
      intro: "自分で書いて整理する概念ごとのノートです。自分だけが見られ、どの試験の問題にもリンクできます。",
      new: "新しいナレッジポイント",
      scopeAll: "個人のナレッジポイントすべて",
      scopeExam: "この試験に関連",
      allNotes: "すべてのノート",
      matchesAll: "すべてに一致",
      search: "タイトルと本文を検索…",
      results_other: "{count} 件",
      reload: "ノートを再読み込み",
      reorderOffExam: "試験で絞り込んだ表示では並べ替えできません。",
      reorderOffFilter: "検索やタグの絞り込み中は並べ替えできません。",
      showAllToReorder: "並べ替えるにはすべてのノートを表示",
      clearToReorder: "並べ替えるには条件をクリア",
      emptyTitle: "ナレッジポイントはまだありません",
      emptyBody: "概念ごとに説明を書き、関連する問題をリンクすれば、自分だけの復習用アウトラインになります。",
      createFirst: "最初のノートを作成",
      noSearchMatch: "「{query}」に一致するノートはありません",
      noTagMatch: "これらのタグに一致するノートはありません",
      noExamNotes: "この試験にリンクしたノートはまだありません",
      tryDifferent: "別の検索語を試すか、条件をクリアしてください。",
      linkOrBrowse: "この試験の問題にナレッジポイントをリンクするか、ライブラリ全体を見てください。",
      resetFilters: "条件をリセット",
      viewAll: "個人のナレッジポイントをすべて表示",
      loadMore: "さらにノートを読み込む",
      loadAllToReorder: "復習の順序を並べ替える前に、グループ全体を読み込んでください。",
      customHint: "カスタム順 · ハンドルをドラッグするか、ハンドルで Space を押してから矢印キーを使うか、移動ボタンを使います。"
    },
    editor: {
      waitingImage: "画像を待っています…",
      notSaved: "未保存",
      saved: "保存済み",
      savedAt: "保存済み · {time}",
      unsaved: "未保存の変更があります",
      leaveFailed: "ノートを保存できませんでした。離れる前にもう一度お試しください。",
      retryLoad: "ノートを再読み込み",
      loading: "ノートを読み込み中",
      copied: "Markdown をコピーしました",
      copyFailed: "コピーできませんでした。Markdown モードでテキストを選択してください。",
      titleLabel: "ナレッジポイントのタイトル",
      titleRequired: "このノートを保存するにはタイトルが必要です。",
      removeTag: "タグ {name} を削除",
      previousIn: "{group}の前のノート",
      nextIn: "{group}の次のノート",
      focusMode: "集中モード",
      focusModeTitle: "集中モード：サイドバーを隠す",
      moreActions: "その他の操作",
      copyMarkdown: "Markdown としてコピー",
      download: ".md ファイルをダウンロード",
      deleteNote: "ノートを削除…",
      conflictTitle: "編集中に、このノートが別のタブまたは端末で保存されました。",
      conflictBody: "ローカルの変更を残す（別の保存を上書きする）か、最新版を読み込む（自分の変更を破棄する）かを選んでください。",
      reloadLatest: "最新版を読み込む",
      keepMine: "自分の変更を残す",
      saveFailed: "保存に失敗しました。",
      textSafe: "テキストはエディターに残っています。",
      discardMetadata: "失敗したメタデータの変更を破棄",
      retryNow: "今すぐ再試行",
      details: "ノートの詳細",
      onThisPage: "このページの内容",
      outline: "アウトライン",
      relatedQuestions: "関連する問題",
      unavailable_other: "リンクした問題のうち {count} 問は利用できなくなりました。",
      linkHint: "このノートで説明している問題をリンクしておくと、まとめて復習できます。",
      linkQuestion: "問題をリンク",
      meta: "作成 {created} · 編集 {edited}",
      uploadingImage: "画像をアップロード中…",
      body: "ナレッジポイントの本文",
      imageRules: "8 MB 以下の PNG、JPEG、WebP 画像を選んでください。",
      uploadFailed: "アップロードに失敗しました。テキストは残っています。",
      linkInvalid: "https、http、mailto、または相対リンクを使ってください。",
      imageFailed: "画像を追加できませんでした。",
      retryUpload: "アップロードを再試行",
      dismissUpload: "アップロードを閉じる",
      placeholder: "書き始めましょう。<kbd>/</kbd> を入力すると表・画像・図を挿入できます。Markdown を貼り付けることもできます。",
      sourceHint: "これが保存される内容そのものです。いつでもビジュアルに戻せます。何も失われません。",
      source: "Markdown ソース",
      drop: "ここにドロップして画像を追加",
      dropRules: "PNG、JPEG、WebP（最大 8 MB）",
      insertBlock: "ブロックを挿入",
      blocks: "ブロック",
      slashMove: "移動",
      slashInsert: "挿入",
      slashKeep: "テキストのまま",
      editLink: "リンクを編集",
      linkUrl: "リンク URL",
      linkUrlHint: "https、http、mailto、または相対リンク",
      removeLink: "リンクを削除",
      apply: "適用",
      formatSelection: "選択範囲の書式",
      italic: "斜体",
      inlineCode: "インラインコード",
      linkShortcut: "リンク · {shortcut}",
      tableControls: "表の操作",
      addRow: "行を追加",
      addColumn: "列を追加",
      removeRow: "行を削除",
      removeColumn: "列を削除",
      removeTable: "表を削除",
      words_other: "{count} 語",
      readingTime_other: "読了まで約 {count} 分",
      hintBlocks: "ブロック",
      hintLink: "リンク",
      hintMarkdown: "Markdown のショートカットが使えます"
    },
    manage: {
      title: "グループとタグ",
      intro: "グループは階層を持たず、1 つのノートは最大 1 つのグループに属します。タグは自由に重ねられます。どちらも自分だけのもので、問題バンクのタグとは別です。",
      rename: "{name} の名前を変更",
      renameButton: "名前を変更",
      notes_other: "{count} 件のノート",
      onNotes_other: "{count} 件のノートで使用",
      groupCount_other: "{count} グループ",
      createFailed: "グループを作成できませんでした",
      deleteGroupConfirm_other: "「{name}」を削除しますか？含まれる {count} 件のノートは「グループなし」に移動し、内容・タグ・問題へのリンクはそのまま残ります。",
      builtIn: "組み込み",
      newGroup: "新しいグループ名",
      addGroup: "グループを追加",
      groupRules: "名前は重複せず空でない必要があります。グループを削除すると、ノートは順序を保ったまま「グループなし」に移動します。",
      caseInsensitive: "大文字と小文字を区別しない",
      deleteTagConfirm_other: "タグ「{name}」を削除しますか？{count} 件のノートから外れますが、ノート自体には影響しません。",
      noTags: "タグはまだありません。ノートから追加できます。",
      tagRules: "名前を変更すると、そのタグを使うすべてのノートが更新されます。削除しても関連付けが外れるだけで、ノートは残ります。"
    },
    delete: {
      label: "ナレッジポイントを削除",
      title: "「{title}」を削除しますか？",
      removes: "{items}を削除します。",
      theNote: "このノート",
      itsScreenshots_other: "{count} 枚のスクリーンショット",
      itsLinks_other: "{count} 問へのリンク",
      kept: "問題とタグは削除されません。",
      keptWithGroup: "問題、「{group}」グループ、タグは削除されません。",
      failed: "このノートを削除できませんでした。もう一度お試しください。",
      confirm: "ノートを削除"
    },
    groupPicker: {
      group: "グループ",
      label: "グループ：{name}",
      moveTo: "グループへ移動",
      newGroup: "新しいグループ",
      newGroupEllipsis: "新しいグループ…",
      namePlaceholder: "グループ名",
      hint: "作成すると、このノートがそのグループに移動します。",
      enterName: "グループ名を入力してください。",
      tooLong: "グループ名は {max} 文字以内にしてください。",
      exists: "「{name}」というグループはすでにあります。"
    },
    tagPicker: {
      add: "タグを追加",
      placeholder: "タグを追加…",
      yours: "あなたのタグ",
      create: "「{name}」を作成"
    },
    link: {
      intro: "アクセスできるすべての試験から、問題 ID または本文で検索します。",
      close: "問題の選択を閉じる",
      search: "タイトルと問題文を検索…",
      allExams: "すべての試験",
      matches: "{count} 件一致 · {shown} 件を表示",
      linked: "リンク済み",
      link: "リンク",
      noQuestions: "一致する問題はありません。",
      reviewNote: "リンクした問題を開くと復習になり、解答は記録されません。",
      saveFailed: "問題へのリンクを保存できませんでした。ノートの保存状態から再試行してください。"
    },
    linkExisting: {
      title: "既存のノートをリンク",
      search: "ナレッジポイントを検索…",
      none: "一致するナレッジポイントはありません。",
      failed: "このノートをリンクできませんでした。もう一度お試しください。"
    },
    related: {
      linkExisting: "既存をリンク",
      newNote: "+ 新しいノート",
      reload: "関連ノートを再読み込み",
      empty: "この問題を参照しているナレッジポイントはまだありません。",
      loadFailed: "関連ノートを読み込めませんでした。もう一度お試しください。",
      createFailed: "ノートを作成してリンクできませんでした。「新しいノート」をもう一度押すと同じ下書きで続けられます。"
    },
    blocks: {
      h1: {
        title: "見出し 1",
        hint: "大きな見出し"
      },
      h2: {
        title: "見出し 2",
        hint: "中くらいの見出し"
      },
      h3: {
        title: "見出し 3",
        hint: "小さな見出し"
      },
      bullets: {
        title: "箇条書き",
        hint: "シンプルなリスト"
      },
      numbers: {
        title: "番号付きリスト",
        hint: "順番のある手順"
      },
      quote: {
        title: "引用",
        hint: "注意書きや試験のポイント"
      },
      table: {
        title: "表",
        hint: "3 行 2 列、見出し行あり"
      },
      image: {
        title: "画像",
        hint: "アップロード・貼り付け・ドロップ · PNG、JPEG、WebP（最大 8 MB）"
      },
      code: {
        title: "コードブロック",
        hint: "等幅フォントで空白を保持"
      },
      diagram: {
        title: "図",
        hint: "Mermaid のフローチャート"
      },
      divider: {
        title: "区切り線",
        hint: "セクション間の線"
      }
    },
    toolbar: {
      label: "ノートの書式",
      styles: {
        h0: "本文",
        h1: "見出し 1",
        h2: "見出し 2",
        h3: "見出し 3"
      },
      textStyle: "テキストスタイル",
      textStyleCurrent: "テキストスタイル：{style}",
      locked: "先に画像のアップロードを完了するか閉じてください",
      link: "リンク",
      insert: "挿入",
      tip: "ヒント：空の行で <kbd>/</kbd> を入力すると、キーボードから離れずに挿入できます。",
      undo: "元に戻す",
      redo: "やり直す",
      mode: "エディターのモード",
      visual: "ビジュアル"
    },
    paste: {
      pasted_other: "{count} 語を書式付きの Markdown として貼り付けました。",
      plain: "プレーンテキストとして貼り付け直す"
    },
    media: {
      enlarged: {
        image: "拡大した画像",
        diagram: "拡大した図"
      },
      close: {
        image: "拡大した画像を閉じる",
        diagram: "拡大した図を閉じる"
      }
    },
    blocksView: {
      unsupported: "未対応の Markdown — ソースを編集できます",
      unsupportedSource: "未対応の Markdown ソース",
      language: "言語",
      codeLanguage: "コードの言語",
      codeSource: "コードのソース",
      editDiagram: "図のソースを編集",
      previewDiagram: "図をプレビュー",
      viewLargerImage: "画像を拡大表示",
      badImageUrl: "この画像 URL には対応していません。",
      altText: "代替テキスト",
      imageAltText: "画像の代替テキスト",
      removeImage: "画像を削除"
    },
    diagram: {
      tooLarge: "図が大きすぎます。12,000 文字・250 行以内にしてください。",
      failed: "図を描画できませんでした",
      didNotRender: "図を描画できませんでした — {error}",
      preview: "プレビュー",
      source: "ソース",
      viewLarger: "図を拡大表示"
    }
  },
  errors: {
    requestFailed: "{path} へのリクエストが失敗しました（{status}）",
    ai: {
      noKey: "先に設定で API キーを入力してください。",
      generateFailed: "解説を生成できませんでした。"
    },
    annotations: {
      saveNote: "注釈のメモを保存できませんでした。離れる前にもう一度お試しください。",
      delete: "注釈を削除できませんでした。もう一度お試しください。"
    },
    question: {
      changed: "この問題は変更されました。試験を更新してもう一度お試しください。",
      loadFailed: "この問題を読み込めませんでした。"
    },
    learning: {
      position: "学習の位置を保存できませんでした。もう一度移動してみてください。",
      studyStatus: "この問題の学習状況を保存できませんでした。もう一度お試しください。"
    },
    mock: {
      start: "この模擬試験を開始できませんでした。もう一度お試しください。",
      answerPending: "模擬試験の解答はまだ保存されていません。切り替えや提出の前に再試行します。",
      timeUp: "時間切れです。この模擬試験は締め切り前に保存された解答で提出されました。",
      alreadySubmitted: "この模擬試験は別のタブまたは端末ですでに提出されています。結果を表示します。",
      answerRejected: "この解答は保存できなかったため、最後に保存した解答が有効です。問題が変更された可能性があります。再読み込みして最新の内容を確認してください。",
      flagPending: "模擬試験のフラグはまだ保存されていません。切り替えや提出の前に再試行します。",
      submit: "この模擬試験を提出できませんでした。解答は残っています。もう一度お試しください。"
    },
    nav: {
      noteFirst: "切り替える前に問題のメモを保存するか破棄してください。",
      cancelled: "変更を保存できなかったため、移動をキャンセルしました。もう一度保存してください。",
      examUnavailable: "この試験は利用できません。別の試験を選んでください。",
      switchConfirm: "学習内容を切り替えますか？練習の解答は保存されて練習は終了します。模擬試験の解答は再開できるよう保存されますが、タイマーは止まりません。",
      saveBeforeSwitch: "作業内容を保存できませんでした。切り替える前にもう一度お試しください。",
      saveNote: "現在のメモを保存できませんでした。離れる前にもう一度お試しください。",
      examNotAvailable: "その試験にはアクセスできません。",
      switchFailed: "切り替えられませんでした：{reason}。作業内容は残っています。保存または切り替えを再試行してください。"
    },
    practice: {
      start: "練習を開始できませんでした。もう一度お試しください。",
      ended: "この練習セッションは終了したため、この解答は保存されませんでした。それまでの解答は残っています。続けるには新しいセッションを始めてください。",
      answer: "解答を保存できませんでした。もう一度送信してください。",
      note: "問題のメモを保存できませんでした。下書きは残っています。問題を切り替える前にもう一度お試しください。",
      finish: "この練習を終了できませんでした。もう一度お試しください。セッションは残っています。",
      bookmark: "ブックマークの変更を保存できませんでした。もう一度お試しください。",
      mastered: "この問題を習得済みにできませんでした。もう一度お試しください。"
    },
    notes: {
      save: "メモを保存できませんでした。下書きは残っています。もう一度お試しください。",
      delete: "このメモを削除できませんでした。もう一度お試しください。"
    },
    appearance: {
      invalid: "外観の応答が無効です。再読み込みしてもう一度お試しください。",
      unavailable: "サイトの外観設定を利用できません"
    },
    workspace: {
      refreshExams: "試験の一覧を更新できませんでした。現在の作業は残っています。もう一度お試しください。",
      loadExams: "試験を読み込めませんでした。もう一度お試しください。",
      selectedGone: "選択していた試験は利用できなくなりました。続けるには利用できる試験を選んでください。",
      switchUnavailable: "この試験は利用できません。作業内容は残っています。保存して利用できる試験に切り替えてください。",
      linkedUnavailable: "リンク先の試験にはアクセスできないため、別の試験を開きました。",
      previousUnavailable: "以前の試験は利用できないため、利用できる試験を選択しました。",
      refreshExam: "この試験を更新できませんでした。現在の作業は残っています。もう一度お試しください。",
      loadExam: "この試験を読み込めませんでした。もう一度お試しください。",
      linkedQuestionGone: "リンク先の問題は利用できなくなりました。",
      noSuchQuestion: "この試験に問題 {sequence} はありません。"
    },
    kp: {
      resolveConflict: "保存する前に版の競合を解決してください。",
      saveFailed: "保存に失敗しました。もう一度お試しください。",
      composing: "離れる前に文字入力を確定してください。",
      unsaved: "ノートに未保存の変更があります。離れる前にもう一度保存してください。",
      loadNote: "このノートを読み込めませんでした。再試行するか一覧に戻ってください。",
      loadNotes: "ノートを読み込めませんでした。もう一度お試しください。",
      loadMore: "さらにノートを読み込めませんでした。もう一度お試しください。",
      stillMoving: "前回の移動をまだ保存しています。完了してからもう一度お試しください。",
      cannotReorder: "この表示では並べ替えできません。1 つのグループをカスタム順で開いて並べ替えてください。",
      orderChanged: "別のタブで順序が変更されました。最新の順序を読み込んだので、もう一度移動してください。",
      orderFailed: "新しい順序を保存できませんでした。以前の順序は残っています。もう一度お試しください。",
      uploadFailed: "画像のアップロードに失敗しました。離れる前に再試行するかアップロードを閉じてください。"
    },
    avatar: {
      type: "JPEG、PNG、WebP の画像を選んでください。",
      read: "この画像ファイルを読み込めませんでした。",
      process: "この画像を処理できませんでした。",
      tooLarge: "圧縮しても画像が大きすぎます。もっと小さいファイルを選んでください。"
    }
  },
  admin: {
    header: {
      eyebrow: "管理ワークスペース",
      title: "アクセスとコンテンツ",
      intro: "ここで学ぶ人を招待し、試験ライブラリを整えましょう。"
    },
    tabs: {
      label: "管理セクション",
      overview: "概要",
      users: "メンバー",
      exams: "コンテンツ",
      mcp: "MCP トークン",
      appearance: "外観"
    },
    count: {
      exams_other: "{count} 件の試験",
      questions_other: "{count} 問"
    },
    mcp: {
      title: "管理者用 MCP トークン",
      desc: "問題バンクの管理権限が必要な管理者向け AI クライアント（例：local-codex、chatgpt-admin）用の特権トークンです。ユーザー用 MCP トークンとは別物で、その代わりには使えません。",
      namePlaceholder: "例：local-codex",
      connectionsTitle: "連携中の管理アプリ",
      connectionsDesc: "サインインして管理者アクセスを承認し、Admin MCP に接続したクライアントです。接続を解除するか管理者でなくなると、すぐにアクセスできなくなります。"
    },
    status: {
      checking: "状態を確認中…",
      checkingDetail: "管理の概要を読み込み中です。",
      unavailable: "状態を取得できません",
      failedDetail: "管理の概要を読み込めませんでした：{message}",
      slow: "応答が遅い",
      slowDetail: "管理の概要に {seconds} 秒以上かかりました（{time}）。",
      ok: "正常に稼働中",
      okDetail: "管理の概要を {time} に読み込みました。"
    },
    overview: {
      requestFailed: "リクエストが完了しませんでした。",
      loadFailed: "概要を読み込めませんでした。",
      kicker: "ひと目で",
      title: "ワークスペースの概要",
      intro: "PrepDeck ワークスペース全体のリアルタイムの合計です。",
      activeLearners: "アクティブな学習者",
      authorizedTotal: "許可済み 合計 {count} 人",
      library: "問題ライブラリ",
      across: "{exams}にわたる",
      attempts: "解答の記録",
      allTime: "これまでの全活動",
      invites: "保留中の招待",
      revoked: "アクセス取り消し {count} 件",
      coverage: "コンテンツの状況",
      byExam: "試験ごとの問題数",
      manageContent: "コンテンツを管理",
      noExams: "試験はまだありません。",
      quick: "クイック操作",
      quickTitle: "何をしますか？",
      invite: "メンバーを招待",
      inviteDesc: "ワークスペースへのアクセスを付与",
      addExam: "試験を追加",
      addExamDesc: "コンテンツライブラリを充実させる"
    },
    users: {
      loadFailed: "許可ユーザーの一覧を読み込めませんでした。",
      inviteFailed: "このアカウントを招待できませんでした。",
      updateFailed: "このアカウントを更新できませんでした。",
      bulkFailed: "選択したアカウントを更新できませんでした。",
      revokeConfirm: "{email} のアクセスを取り消しますか？過去のデータは残り、「復元」で元に戻せます。",
      resetConfirm: "{email} の Google リンクをリセットしますか？次にこのアドレスでサインインした Google アカウントが、このアカウントとすべてのデータを引き継ぎます。アカウントが正当に引き継がれたと確認できる場合にのみ行ってください。 すべてのブラウザーからサインアウトし、個人アクセストークンと接続済みアプリも失効します。復旧後に再接続が必要です。",
      bulkRevokeConfirm_other: "{count} 件のアカウントのアクセスを取り消しますか？「復元」で元に戻せます。",
      search: "メンバーを検索",
      searchPlaceholder: "メンバーを検索…",
      filters: {
        all: "すべて",
        active: "有効",
        invited: "招待済み",
        revoked: "取り消し済み"
      },
      invitePeople: "メンバーを招待",
      makeAdmin: "管理者にする",
      makeUser: "ユーザーにする",
      revokeAccess: "アクセスを取り消す",
      selectAll: "表示中のメンバーをすべて選択",
      select: "{email} を選択",
      person: "メンバー",
      role: "役割",
      roleOf: "{email} の役割",
      status: "状態",
      lastSignIn: "最終サインイン",
      you: "あなた",
      resetLink: "リンクをリセット",
      resetLinkTitle: "この行に結び付いた Google アカウントのリンクを解除し、次にこのアドレスでサインインしたアカウントが引き継げるようにします",
      restore: "復元",
      noMatch: "「{query}」に一致するユーザーはいません。",
      footnote: "招待したアカウントは最初の Google サインインで有効になります。取り消してもすべての履歴データは残り、元に戻せます。",
      inviteTitle: "アカウントを招待",
      inviteSubtitle: "最初の Google サインインからアクセスできるようになります。",
      googleEmail: "Google のメールアドレス",
      tempPassword: "仮パスワード",
      tempPasswordPlaceholder: "任意 — 開発・ローカル環境のみ",
      tempPasswordHint: "このデプロイがメールアドレスとパスワードでサインインする場合にのみ使われます。",
      createdInvited: "状態「招待済み」で作成されます。",
      inviting: "招待中…",
      sendInvite: "招待を送信"
    },
    exams: {
      loadFailed: "試験を読み込めませんでした。",
      providersFailed: "提供元を読み込めませんでした。「コンテンツ」を開き直して再試行してください。",
      assignFailed: "提供元の割り当てを更新できませんでした。",
      badgeAfterCreate: "試験は作成されましたが、バッジをアップロードできませんでした：{reason}",
      uploadFailed: "アップロードに失敗しました",
      createFailed: "この試験を作成できませんでした。",
      archiveConfirm: "「{name}」をアーカイブしますか？すべてのユーザーの練習・模試の設定に表示されなくなります。",
      updateFailed: "この試験を更新できませんでした。",
      badgeFailed: "このバッジアイコンをアップロードできませんでした。",
      search: "試験を検索",
      searchPlaceholder: "試験を検索…",
      allProviders: "すべての提供元",
      new: "新しい試験",
      newSubtitle: "スラッグはインポートと URL に使われます。変更しないようにしてください。",
      archived: "アーカイブ済み",
      active: "有効",
      questionsUnit_other: "問",
      open: "開く",
      noMatch: "一致する試験はありません。",
      name: "名前",
      slug: "スラッグ",
      subject: "科目",
      subjectPlaceholder: "アーキテクチャ",
      language: "言語",
      badgeIcon: "バッジアイコン",
      badgeHint: "正方形の PNG / SVG",
      browse: "参照",
      addQuestionsAfter: "作成後すぐに問題を追加できます。",
      create: "試験を作成",
      badge: "バッジ",
      editDetails: "詳細を編集",
      replaceBadge: "バッジを置き換え",
      addBadge: "バッジを追加",
      archive: "アーカイブ",
      unarchive: "アーカイブを解除",
      providersHint: "タップしてこの試験の割り当てを切り替えます。"
    },
    examSettings: {
      title: "試験の詳細を編集",
      subtitle: "バッジ、提供元、公式形式、アーカイブは別に編集します。",
      nameRequired: "名前は必須です。",
      slugInvalid: "スラッグ：ハイフンで区切った小文字と数字にしてください（例：aws-sap-c02）。",
      passInvalid: "合格点は 0～100 の割合で指定してください。",
      saveFailed: "詳細を保存できませんでした。",
      description: "説明",
      passMark: "合格点（%）",
      passUnused: "公式の試験形式が設定されている間は使われません。模擬試験はその形式の正解率で合否が決まります。",
      passHint: "模擬試験はこの正解率で合格となります。空欄にすると合格点なしになります。",
      slugWarning: "スラッグはこの試験の URL の一部で、送信済みの毎日の復習メールのリンクにも含まれ、インポートファイルや連携から参照されている場合もあります。変更すると <slug>{old}</slug> を使ったリンクは機能しなくなります。",
      slugConfirm: "スラッグを <slug>{next}</slug> に変更する",
      onlyChanged: "変更した項目だけが保存されます。",
      noChanges: "まだ変更はありません。",
      save: "詳細を保存"
    },
    format: {
      title: "公式の試験形式",
      intro: "本番試験の問題数、制限時間、合格点です。模擬試験はこれをもとにフル・ハーフ・スプリントの長さを用意し、同じ正解率で合否を判定します。",
      replacesPass: "設定すると {pass}% の合格点に代わって使われます。",
      fillAll: "3 つの値をすべて入力してください。",
      wholeNumbers: "0 より大きい整数を入力してください。",
      passTooHigh: "合格に必要な正解数は問題数を超えられません。",
      saveFailed: "試験形式を保存できませんでした。",
      passCount: "合格に必要な正解数",
      save: "形式を保存",
      saved: "保存しました。",
      summary: "合格点 {pass}% · 1 問あたり {minutes} 分。",
      notSet: "未設定 — 模擬試験はスプリントとカスタムの長さのみになります。"
    },
    providers: {
      title: "提供元",
      manage: "提供元を管理",
      new: "新しい提供元",
      edit: "提供元を編集",
      none: "提供元はまだありません。",
      noneActive: "有効な提供元はありません。",
      noneAtAll: "提供元はありません。",
      deleteConfirm: "「{name}」を完全に削除しますか？元に戻せません。試験に割り当てられている提供元は削除できないため、代わりにアーカイブしてください。",
      updateFailed: "この提供元を更新できませんでした。もう一度お試しください。",
      editSubtitle: "提供元はメニューや選択肢で試験をグループ化します。",
      manageSubtitle: "提供元をアーカイブすると、試験と問題を残したまま選択肢から隠せます。",
      showArchived: "アーカイブ済みの提供元を表示",
      iconRules: "2 MB 以下の JPEG、PNG、WebP のアイコンを選んでください。",
      pleaseRetry: "もう一度お試しください。",
      iconFailed: "提供元は保存されましたが、アイコンを更新できませんでした。",
      saveFailed: "提供元を保存できませんでした。",
      shortName: "略称",
      website: "公式 URL",
      icon: "アイコン",
      currentIcon: "現在の提供元アイコン",
      iconHint: "JPEG、PNG、WebP · 最大 2 MB",
      removeIcon: "現在のアイコンを削除",
      assignHint: "試験の割り当ては各試験の詳細ページから行います。",
      save: "提供元を保存",
      add: "提供元を追加"
    },
    mascot: {
      title: "サイトのマスコット",
      intro: "サインイン画面を含め、PrepDeck 全体で使うマスコットを選びます。この設定は全員に適用されます。",
      loading: "現在のマスコットを読み込み中…",
      current: "現在のマスコット：{style}",
      loadFailed: "現在のマスコットを読み込めませんでした。最後に取得できたスタイルを表示しています。",
      retry: "再読み込み",
      style: "マスコットのスタイル",
      styles: {
        chibi3d: "3D ちびキャラ",
        anime2d: "2D アニメ"
      },
      preview: "{style} のプレビュー",
      currentStyle: "現在のサイトのスタイル",
      previewShort: "プレビュー",
      save: "マスコットを保存",
      saved: "全員のマスコットを更新しました。他のユーザーには再読み込みするか PrepDeck に戻ったときに反映されます。",
      saveFailed: "保存できませんでした。もう一度お試しください。",
      kept: "選択は残っています。もう一度保存できます。"
    }
  },
  authoring: {
    types: {
      single_choice: "単一選択",
      multiple_choice: "複数選択",
      true_false: "正誤",
      fill_blank: "穴埋め",
      ordering: "並べ替え",
      matching: "組み合わせ"
    },
    typesInline: {
      single_choice: "単一選択",
      multiple_choice: "複数選択",
      true_false: "正誤",
      fill_blank: "穴埋め"
    },
    fields: {
      type: "種類",
      stem: "問題文",
      options: "選択肢",
      correctAnswers: "正解",
      explanation: "公式解説",
      externalId: "外部 ID",
      difficulty: "難易度",
      points: "配点",
      tags: "タグ",
      needsReview: "要レビュー"
    },
    list: {
      range: "{total} 件中 {range} 件",
      export: "このページをエクスポート",
      exportFailed: "問題をエクスポートできませんでした",
      import: "JSON をインポート",
      add: "問題を追加",
      searchLabel: "問題文、または内部 / 外部 ID の完全一致で検索",
      searchPlaceholder: "問題文または ID で検索…",
      filterType: "種類で絞り込む",
      allTypes: "すべての種類",
      filterDifficulty: "難易度で絞り込む",
      allDifficulties: "すべての難易度",
      filterTag: "タグの完全一致で絞り込む",
      exactTag: "タグ（完全一致）",
      filterReview: "レビュー状態で絞り込む",
      anyReview: "すべてのレビュー状態",
      needsReview: "要レビュー",
      reviewed: "レビュー済み",
      filterArchived: "アーカイブ状態で絞り込む",
      anyStatus: "すべての状態",
      activeOnly: "有効のみ",
      archivedOnly: "アーカイブ済みのみ",
      bankEmpty: "この問題バンクは空です。問題を追加して作成を始めましょう。",
      noMatch: "現在の条件に一致する問題はありません。",
      archivedAt: "{when} にアーカイブ",
      archivedTag: "アーカイブ済み",
      id: "ID：{id}",
      externalId: "外部 ID：{id}",
      archiveConfirm: "問題 #{sequence} をアーカイブしますか？学習者は練習、模擬試験、学習モード、復習リストでこの問題を見なくなります。解答・メモなどの履歴は残り、いつでも復元できます。",
      archived: "問題 #{sequence} をアーカイブしました。",
      restored: "問題 #{sequence} を復元しました。",
      archiveFailed: "問題をアーカイブできませんでした。",
      restoreFailed: "問題を復元できませんでした。",
      deleteConfirm: "この問題を完全に削除しますか？解答・ブックマーク・メモなどの学習記録がある問題は削除できないため、代わりにアーカイブしてください。",
      deleted: "問題 #{sequence} を削除しました。",
      deleteFailed: "問題を削除できませんでした。",
      saved: "問題 #{sequence} を保存しました。",
      savedWithId: "問題 #{sequence}（{id}）を保存しました。",
      imported: "インポートが完了しました。インポートダイアログで問題ごとの結果を確認してください。"
    },
    editor: {
      editTitle: "問題を編集",
      close: "問題エディターを閉じる",
      revision: "版 {revision}",
      view: "問題の表示",
      stale: "編集中に、誰かがこの問題の新しい版を保存しました。",
      saveFailed: "この問題を保存できませんでした。入力内容は残っています。",
      discardLatestTitle: "変更を破棄して最新版を読み込みますか？",
      discardLatestBody: "未保存の変更は、最後に保存された問題で置き換えられます。",
      discardLatestAction: "破棄して最新版を読み込む",
      loadedRevision: "版 {revision} を読み込みました。",
      changedSince: "開いてから変更された項目：{fields}。",
      editsKept: "変更内容は残っています。確認してからもう一度保存してください。",
      loadLatestFailed: "最新版を読み込めませんでした。",
      loadLatestFailedReason: "最新版を読み込めませんでした：{reason}",
      changedType: "{type}に変更しました。{cleared}",
      clearedBoth: "選択肢と正解をクリアしました。",
      clearedOptions: "選択肢をクリアしました。",
      clearedAnswers: "正解をクリアしました。",
      removedOption: "選択肢 {id} を削除しました。",
      removedCorrectOption: "選択肢 {id}（正解）を削除しました。",
      stemMarkdown: "問題文 · Markdown",
      optionsAnswers: "選択肢と正解",
      selectAtLeastTwo: "正解を 2 つ以上選んでください。",
      selectOne: "正解を 1 つ選んでください。",
      option: "選択肢 {id}",
      correctAnswerFor: "正解 {id}",
      removeOption: "選択肢 {id} を削除",
      optionMarkdown: "選択肢 {id} · Markdown",
      addOption: "選択肢を追加",
      acceptedAnswers: "正解として認める解答（1 行に 1 つ）",
      blankLines: "空行は無視されます。",
      explanationMarkdown: "公式解説 · Markdown",
      externalIdLabel: "外部 ID（任意、この試験内で一意）",
      needsReviewHelp: "レビュー状態はタグではなく問題そのものに保存されます。インポートで設定されるので、確認が済んだら外してください。",
      markdownPreview: "Markdown のプレビュー",
      yourEditsKept: "変更内容は残っています。",
      loadKeep: "最新版を読み込み、自分の変更を残す",
      discardMine: "自分の変更を破棄",
      checkFields: "強調表示された項目を確認してください。入力内容は残っています。",
      savedRevision: "版 {revision} を保存しました。未保存の変更はありません。",
      noUnsaved: "未保存の変更はありません",
      saveAddNext: "保存して次を追加"
    },
    component: {
      title: "コンポーネント問題を編集",
      intro: "構造化パッケージを編集します。問題が有効になるとプレビューが更新されます。",
      fields: {
        body: "問題本文",
        interaction: "解答形式",
        stimuli: "共有資料",
        assets: "アセット",
        correctResponse: "正しい解答",
        archive: "アーカイブ状態"
      },
      answerEditFailed: "元に戻す履歴を保ったまま解答を変更できませんでした。ソースは残っています。JSON で解答を編集してください。",
      previousRestored: "前の下書きに戻しました。",
      nextRestored: "次の下書きに進めました。",
      formatUndoFailed: "元に戻す履歴を保ったまま JSON を整形できませんでした。ソースは残っています。",
      formatFailed: "JSON を整形できませんでした。ソースは残っています。",
      saveFailed: "問題を保存できませんでした",
      discardLatestBody: "元の JSON は、最後に保存された問題で置き換えられます。",
      changedSinceRevision: "版 {revision} 以降に変更された項目：{fields}。",
      noChangesSince: "版 {revision} 以降、内容に変更はありません。",
      rawKept: "元の JSON は残っています。",
      draftMatches: "下書きは最後に保存された問題と同じになりました。",
      reviewThenSave: "問題を確認し、準備ができたら保存してください。",
      tryAgain: "もう一度お試しください。",
      changed: "この問題は変更されました。",
      view: "編集の表示",
      answerControls: "解答の設定",
      formatJson: "JSON を整形",
      packageJson: "問題パッケージの JSON",
      packageErrors: "問題パッケージのエラー",
      syntaxError: "JSON の構文エラー：{message}",
      syntaxErrorAt: "JSON の構文エラー（{line} 行 {column} 列）：{message}",
      validationErrors: "パッケージの検証エラー：",
      preview: "コンポーネント問題のプレビュー",
      previewStale: "プレビューは最新ではありません。最後の有効な下書きを表示しています。",
      previewNone: "有効なプレビューはまだありません。パッケージのエラーを直すとプレビューが表示されます。",
      leftPreviewItems: "左側のプレビュー項目",
      rightPreviewItems: "右側のプレビュー項目",
      table: "問題の表",
      missingFigure: "図が見つかりません: {alt}"
    },
    answers: {
      label: "解答の設定",
      sequence: "正しい順序",
      matches: "正しい組み合わせ",
      intro: "ここで正解を変更します。内容・ID・構造は JSON で編集してください。",
      answer: "解答 {id}",
      idCode: "ID：<code>{id}</code>",
      moveUp: "{id} を上へ移動",
      moveDown: "{id} を下へ移動",
      up: "↑ 上へ",
      down: "↓ 下へ",
      moved: "{id} を {total} 個中 {position} 番目に移動しました。",
      rightReuse: "右側の項目は複数回使うことも、使わないこともできます。",
      leftItems: "左側の項目",
      rightItems: "右側の項目",
      leftIdCode: "左側 ID：<code>{id}</code>",
      rightIdCode: "右側 ID：<code>{id}</code>",
      leftId: "左側 ID：{id}",
      rightId: "右側 ID：{id}",
      rightFor: "{id} に対応する右側の項目",
      matchChanged: "{id} の組み合わせを変更しました。",
      reasons: {
        tooLarge: "解答の設定はインポート上限の 5 MiB までのパッケージに対応しています。このソースは JSON で編集してください。",
        invalid: "解答の設定には、重複キーのない有効な schema 2.0 の問題が 1 つ必要です。JSON でパッケージのエラーを直してください。",
        duplicates: "重複キーがあるため解答の設定は使えません。JSON であいまいなプロパティを解消してください。",
        unsupported: "解答の設定は並べ替えと組み合わせの問題にのみ対応しています。この問題は JSON で編集してください。",
        failed: "解答の設定でこのソースを解析できませんでした。JSON で編集を続けてください。"
      }
    },
    json: {
      invalid: "JSON の構文が正しくありません。",
      unlocated: "JSON の構文を確認してください。エラーの位置を特定できませんでした。",
      schemaVersion: "\"2.0\" である必要があります",
      oneQuestion: "このエディターでは問題を 1 つだけ含める必要があります",
      validateFailed: "このパッケージを検証できませんでした。構造を確認してもう一度お試しください。",
      location: "{line} 行 {column} 列",
      duplicateKey: "オブジェクトのキー {name} が {location} で重複しています（最初の宣言は {first}）。保存する前にどちらかのキーを削除するか名前を変更してください。",
      duplicateLimit: "最初の 50 件の重複キーだけを表示しています。修正してからもう一度確認してください。",
      duplicateFailed: "このパッケージの重複キーを確認できませんでした。入れ子を浅くしてもう一度お試しください。ソースは残っています。",
      formatChanges: "内容を変えずに JSON を整形できませんでした。ソースは残っています。",
      syntax: {
        InvalidSymbol: "予期しない記号です。JSON の値または記号を使ってください。",
        InvalidNumberFormat: "JSON の数値が正しくありません。",
        PropertyNameExpected: "ダブルクォートで囲んだプロパティ名が必要です。",
        ValueExpected: "JSON の値が必要です。",
        ColonExpected: "プロパティ名の後にコロンが必要です。",
        CommaExpected: "値やプロパティの間にカンマが必要です。",
        CloseBraceExpected: "閉じ波かっこ（}）が必要です。",
        CloseBracketExpected: "閉じ角かっこ（]）が必要です。",
        EndOfFileExpected: "JSON の値の後に余分な内容があります。",
        InvalidCommentToken: "JSON ではコメントを使えません。",
        UnexpectedEndOfComment: "JSON ではコメントを使えません。",
        UnexpectedEndOfString: "この文字列には閉じダブルクォートがありません。",
        UnexpectedEndOfNumber: "この数値は不完全です。",
        InvalidUnicode: "この文字列には無効な Unicode エスケープが含まれています。",
        InvalidEscapeCharacter: "この文字列には無効なエスケープシーケンスが含まれています。",
        InvalidCharacter: "この文字列にはエスケープされていない制御文字が含まれています。"
      }
    },
    import: {
      title: "問題をインポート",
      intro: "新しい問題はこの試験に追加されます。下で取り込む版を明示的に適用しない限り、既存の内容は残ります。",
      pdfTitle: "PDF から問題を準備する",
      pdfBody: "pdf-to-quiz スキルで PDF を変換し、元のページと照らして問題と解答を確認してから、生成された JSON を下でアップロードしてください。",
      capabilities: "対応コンテンツ：{blocks}。解答形式：{interactions}。従来形式とコンポーネント形式の JSON をインポートできます。",
      schemasFailed: "PDF 準備用の形式を読み込めませんでした。準備済みの JSON ファイルはインポートできます。",
      schemasLoading: "PDF 準備用の形式を読み込み中…",
      downloadSchemas: "変換用スキーマをダウンロード",
      file: "問題インポート用の JSON ファイル",
      tooLarge: "インポートファイルは 5 MiB 以下にしてください。",
      validateFailed: "ファイルを検証できませんでした。",
      failed: "インポートに失敗しました。プレビューを更新してから再試行してください。",
      processing: "処理中…",
      incoming_other: "取り込む問題 {count} 件",
      conflicts_other: "競合 {count} 件",
      previewTitle: "取り込む問題をプレビュー",
      previewNote: "最大 5 問まで表示しています。インポートする前にソース全体を確認してください。",
      current: "現在：{value}",
      incomingValue: "取り込み：{value}",
      ambiguous: "複数の問題がこの外部 ID を共有しています。エディターで ID を修正してから、インポートをもう一度検証してください。",
      resolution: "解決方法",
      keep: "現在の版を残す",
      apply: "取り込む版を適用",
      results: "インポート結果",
      summary: "作成 {created} · 更新 {updated} · スキップ / 競合 {skipped} · 失敗 {failed}",
      retryNote: "失敗または競合したレコードだけを再試行してください。外部 ID のない問題はインポートのたびに新しいレコードになります。",
      execute: "選択した方法でインポート"
    },
    guard: {
      title: "未保存の変更を破棄しますか？",
      body: "問題の変更はまだ保存されていません。続けるには破棄してください。",
      action: "変更を破棄",
      keep: "編集を続ける"
    },
    preview: {
      notSelected: "未選択",
      noAnswers: "正解：未選択"
    },
    tags: {
      lengthError: "1～{max} 文字のタグ名を入力してください。",
      selected: "選択したタグ",
      placeholder: "タグを検索または作成…",
      available: "利用できるタグ",
      alreadySelected: "このタグはすでに選択されています。",
      loading: "タグを読み込み中…",
      none: "一致するタグはありません。名前を入力すると作成できます。",
      hint: "既存のタグを選ぶか新しく作成します。変更は問題と一緒に保存されます。",
      limit: "1 問あたりのタグは {max} 個までです。追加するには 1 つ削除してください。",
      loadFailed: "タグを読み込めませんでした。この問題の編集は続けられます。",
      retry: "タグを再読み込み"
    },
    classifications: {
      filterBy: "{label}で絞り込む",
      unclassified: "未分類 / あいまい（{count}）",
      loadFailed: "分類の絞り込みを読み込めませんでした。",
      retry: "絞り込みを再読み込み"
    }
  },
  annotations: {
    underline: "下線",
    bold: "太字",
    deleteMark: "マークを削除",
    title: "自分の注釈",
    selectHint: "下のテキストを選択すると、ハイライト・下線・太字にできます。",
    private: "マークは自分だけのもので、解答中は表示されません。",
    filter: "絞り込み：",
    clearFilter: "絞り込みをクリア",
    sort: "マークの並び順",
    oldest: "古い順",
    newest: "新しい順",
    filterFailed: "この絞り込みを適用できませんでした。表示中のマークは最新でない可能性があります。",
    noMatchTitle: "この絞り込みに一致するマークはありません",
    noMatchBody: "この試験のマークには、選択したマークの種類が使われていません。",
    emptyTitle: "注釈はまだありません",
    emptyBody: "学習モードで、または練習で解答を確認したり模擬試験を提出したりした後に、問題のテキストを選択するとハイライト・下線・太字にできます。マークと問題のメモはここに集まります。",
    goLearning: "学習へ移動",
    marks_other: "マーク {count} 件",
    markNote: "このマークにメモを追加…"
  },
  mock: {
    setup: {
      title: "本番を体験する",
      intro: "時間制限あり・ランダム出題・提出するまでフィードバックなし。",
      requiredCorrect: "{total} 問中 {required} 問正解",
      notSet: "未設定",
      inProgress: "進行中の試験があります",
      answered: "{total} 問中 {answered} 問に解答済み。",
      answeredLeft_other: "{total} 問中 {answered} 問に解答済み · サーバーの時計で残り {count} 分。",
      resumeOrSubmit: "再開するか、提出してから新しい試験を始めてください。",
      resume: "試験を再開",
      format: "形式",
      formatDesc: "問題数と制限時間を選びます。",
      formats: {
        full: "フル",
        half: "ハーフ",
        sprint: "スプリント",
        custom: "カスタム"
      },
      formatSize: "{count} 問 · {minutes} 分",
      formatSizeFull: "{count} 問 · {minutes} 分。本番と同じです。",
      customDesc: "問題数と時間を自分で設定",
      timeLimit: "制限時間（分）",
      countError: "1～{max} の整数を入力してください。",
      minutesError: "{min}～{max} の整数で分数を入力してください。",
      noOfficial: "管理者がこの試験の公式形式を設定すると、フルとハーフの試験が表示されます。",
      howItWorks: "しくみ",
      rules: {
        random: {
          title: "ランダム出題・重複なし",
          desc: "問題は問題バンク全体から抽出されます。"
        },
        noFeedback: {
          title: "提出までフィードバックなし",
          desc: "見直したい問題は、提出前にフラグを付けておきましょう。"
        },
        serverClock: {
          title: "サーバー側の時計",
          desc: "タブを閉じてもタイマーは進み続けます。"
        },
        autosave: {
          title: "解答は自動で保存",
          desc: "接続が切れても受験が無駄になることはありません。"
        }
      },
      summary: "試験の概要",
      minutes: "分",
      pace: "ペース",
      paceValue: "1 問あたり {minutes} 分",
      passMark: "合格点",
      shortBank_other: "この問題バンクは {count} 問しかないため、すべての問題を使います。",
      shortBankPace_other: "この問題バンクは {count} 問しかないため、同じペースですべての問題を使います。",
      shortBankSkipping_other: "レビュー中の問題を除くとこの問題バンクは {count} 問しかないため、すべての問題を使います。",
      shortBankSkippingPace_other: "レビュー中の問題を除くとこの問題バンクは {count} 問しかないため、同じペースですべての問題を使います。",
      allUnderReview: "この試験の問題はすべてレビュー中です。試験を始めるには含めてください。",
      resumeInProgress: "進行中の試験を再開",
      begin: "試験を開始"
    },
    live: {
      timeLeft: "残り {minutes} 分 {seconds} 秒",
      lowTime: "残り 5 分未満",
      serverClock: "サーバーの時計 · 解答は自動で保存",
      answeredOf: "{total} 問中 {answered} 問解答済み",
      flag: "フラグ",
      flagged: "フラグ付き",
      submitExam: "試験を提出",
      reviewSubmit: "確認して提出",
      palette: "問題パレット",
      answered: "解答済み",
      left: "残り",
      notAnswered: "未解答",
      answeredState: "解答済み",
      flaggedState: "フラグ付き",
      stateSeparator: "、"
    },
    results: {
      nCorrect: "{count} 問正解",
      above: "+{count} 問",
      short: "あと {count} 問",
      missed: "不正解",
      unanswered: "未解答 {count} 問",
      toReview: "要復習",
      timeUsed: "所要時間",
      minutes: "{count} 分",
      notPassed: "不合格",
      below: "合格点に届きませんでした",
      aboveMark: "合格点を超えました",
      complete: "試験終了",
      heroSub: "{minutes} 分使用 · {total} 問 · {correct} 問正解",
      newMock: "新しい模試",
      noMisses: "練習する誤答はありません",
      practiceMisses_other: "誤答 {count} 問を練習",
      breakdown: "問題ごとの結果",
      breakdownSub: "見直したい問題をブックマークしたり、ナレッジポイントを開いたりできます。",
      filter: "問題を絞り込む",
      filterAll: "すべて {count}",
      filterMissed: "不正解 {count}",
      filterCorrect: "正解 {count}",
      domain: "分野",
      yours: "あなたの解答",
      actions: "操作",
      emptyView: "この表示には問題がありません。",
      questionKps: "問題のナレッジポイント"
    },
    submit: {
      title: "試験を提出しますか？",
      answered_other: "{count} 問中 {answered} 問に解答しました。",
      answeredFlagged: "{total} 問中 {answered} 問に解答し、{flagged} 問にフラグを付けました。",
      warning: "未解答の問題は不正解として採点され、提出後は解答を変更できません。",
      keepGoing: "続ける",
      submit: "提出"
    }
  }
};

export default messages;
