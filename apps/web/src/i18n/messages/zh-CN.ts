// Simplified Chinese (zh-CN) interface messages (issue #191). Same keys as ./en.ts, which
// is the source of truth; a key left out here falls back to English.
// Plural messages need only `_other`: Chinese has no grammatical plural.
// docs/guides/internationalization.md describes how to update this file.

import type { LocaleMessages } from "./en";

const messages: LocaleMessages = {
  common: {
    loading: "加载中…",
    retry: "重试",
    dismiss: "关闭",
    save: "保存",
    saving: "保存中…",
    cancel: "取消",
    close: "关闭",
    delete: "删除",
    edit: "编辑",
    remove: "移除",
    back: "返回",
    next: "下一个",
    previous: "上一个",
    done: "完成",
    search: "搜索",
    clear: "清除",
    copy: "复制",
    copied: "已复制",
    create: "创建",
    all: "全部",
    on: "开",
    off: "关",
    today: "今天",
    todayAt: "今天 {time}",
    select: "请选择",
    date: "日期",
    clearDate: "清除日期",
    chooseDate: "选择日期",
    togglePassword: "显示或隐藏密码",
    characters: "{length} / {max} 个字符",
    listSeparator: "、",
    difficulty: {
      easy: "简单",
      medium: "中等",
      hard: "困难",
      unspecified: "未指定"
    },
    roles: {
      admin: "管理员",
      user: "用户"
    }
  },
  language: {
    label: "语言",
    description: "PrepDeck 菜单、按钮和提示所用的语言，保存在此浏览器中。题目内容和你的笔记保持原样。",
    loadFailed: "无法加载此语言，请重试。"
  },
  nav: {
    mainNavigation: "主导航",
    breadcrumb: "面包屑导航",
    more: "更多",
    learningTitle: "学习模式 #{sequence}",
    screens: {
      dash: "统计",
      learning: "学习模式",
      practice: "练习",
      mock: "模拟考试",
      knowledgePoints: "知识点",
      bookmarks: "书签",
      wrong: "错题",
      notes: "批注",
      settings: "设置",
      admin: "管理"
    },
    groups: {
      overview: "概览",
      study: "学习",
      resources: "资料",
      system: "系统"
    },
    tabs: {
      dash: "首页",
      practice: "练习",
      mock: "模考",
      wrong: "错题"
    }
  },
  shell: {
    loadingExam: "正在加载此考试…",
    noExams: "暂时没有可用的考试。请联系管理员添加考试。",
    switching: "切换前正在保存你的进度…"
  },
  exams: {
    title: "考试",
    select: "选择考试",
    selectAnExam: "选择一个考试",
    selectCurrent: "选择考试，当前考试：{name}",
    selectCurrentWithSlug: "{slug} — 选择考试，当前考试：{name}",
    otherProvider: "其他"
  },
  auth: {
    expired: {
      title: "你的登录已过期",
      body: "请重新登录以继续。已保存的内容都会保留。",
      bodyMock: "请重新登录以继续。已保存的内容都会保留；未能保存的模考答案会在你继续考试时恢复。考试计时不会暂停。",
      notNow: "暂不",
      signInAgain: "重新登录"
    }
  },
  profile: {
    avatarOf: "{name} 的头像",
    loading: "正在加载个人资料"
  },
  login: {
    mascotSignIn: "抱着一摞书的 PrepDeck 吉祥物",
    mascotDenied: "拿着挂锁、一脸抱歉的 PrepDeck 吉祥物",
    alreadyLinked: "已被关联",
    inviteOnly: "仅限受邀用户",
    conflictTitle: "已关联到其他账号",
    deniedTitle: "未获得访问授权",
    conflictBody: "此邮箱地址已获授权，但已经关联了另一个 Google 账号——如果用当前账号登录，就会接管别人的数据。请让管理员在“授权用户”中重置它的 Google 关联，然后再登录。",
    deniedBody: "你已成功登录，但该账号不在 PrepDeck 的授权名单中。请让管理员邀请它，然后再试一次。",
    tryDifferentAccount: "换一个账号",
    welcome: "欢迎回来！",
    tagline: "所有练习题，尽在一副卡组。登录后开始练习，或从上次停下的地方继续。",
    signedOut: "你已退出登录。重新登录即可从上次停下的地方继续。",
    oauthError: "Google 登录未完成。请检查网络连接后重试——没有提交任何内容。",
    verification: {
      failed: "我们无法确认你是真人，或者验证已过期。请重新完成验证，然后登录。",
      unavailable: "人机验证暂时不可用，因此无法开始登录。你的验证没有问题，请几分钟后再试。",
      misconfigured: "此服务器的人机验证配置有误，导致无法登录。请联系管理员。"
    },
    reverified: "验证完成，现在可以登录了。",
    signingIn: "正在登录…",
    signInWithGoogle: "使用 Google 登录",
    invitationOnly: "仅限受邀访问。请使用管理员已批准的 Google 账号，或联系管理员申请访问权限。"
  },
  legal: {
    privacy: "隐私政策",
    terms: "服务条款",
    home: "PrepDeck 首页",
    back: "返回 PrepDeck",
    englishOnly: "本文件仅提供英文版本，以英文文本为准。"
  },
  turnstile: {
    label: "人机验证",
    loading: "正在加载人机验证…",
    expired: "验证已过期，正在刷新…",
    failed: "人机验证未完成。",
    unavailable: "人机验证加载失败，请检查网络连接。",
    configFailed: "无法确定是否需要人机验证，请检查网络连接。",
    tryAgain: "重试"
  },
  settings: {
    groups: {
      account: "账号",
      study: "学习",
      studyDesc: "PrepDeck 的外观、标记和提醒方式。",
      integrations: "AI 与集成",
      integrationsDesc: "用你自己的密钥，连你自己的客户端。"
    },
    nav: {
      sections: "设置分区",
      profile: "个人资料",
      session: "退出登录",
      appearance: "外观",
      language: "语言",
      marks: "标记别名",
      notes: "共享笔记",
      timezone: "时区",
      email: "每日邮件",
      ai: "AI 解析",
      mcp: "MCP 访问",
      aiReady: "就绪",
      aiLocked: "已锁定",
      aiNotSet: "未设置"
    },
    profile: {
      yourProfile: "你的个人资料",
      signedInWithGoogle: "已通过 Google 登录",
      uploading: "上传中…",
      uploadAvatar: "上传头像",
      avatarUploadFailed: "无法上传这张图片。",
      displayName: "显示名称",
      displayNameDesc: "在你修改之前使用 Google 账号的名称。",
      displayNameEmpty: "请输入显示名称后再保存。",
      nameSaveFailed: "无法保存显示名称，请重试。"
    },
    session: {
      title: "在所有设备上退出登录",
      desc: "结束你在所有设备和浏览器上的登录。MCP 令牌和已连接应用是独立的，请在下方撤销。",
      removeKey: "同时从此浏览器移除我保存的 AI 密钥",
      signOut: "退出登录"
    },
    appearance: {
      title: "外观",
      desc: "保存在此浏览器中，立即在所有页面生效。"
    },
    themes: {
      light: {
        name: "明亮",
        hint: "默认"
      },
      cream: {
        name: "奶油",
        hint: "柔和"
      },
      sage: {
        name: "鼠尾草",
        hint: "沉静"
      },
      clay: {
        name: "陶土",
        hint: "温暖"
      },
      dusk: {
        name: "黄昏",
        hint: "弱光"
      }
    },
    marks: {
      title: "标记别名",
      desc: "为每种高亮起一个对你有意义的名字。名称随账号同步，颜色跟随主题。",
      names: {
        hl1: "第一种标记",
        hl2: "第二种标记",
        hl3: "第三种标记"
      },
      sample: "<hl1>网关终端节点</hl1>让 S3 流量留在 VPC 内，而<hl2>接口终端节点</hl2>使用 PrivateLink，并且<hl3>按小时计费</hl3>。"
    },
    sharedNotes: {
      title: "显示其他用户共享的笔记",
      desc: "你自己的笔记始终显示，无论私有还是共享。"
    },
    timezone: {
      title: "时区",
      desc: "统计按此时区计算天和周，每日邮件也按此时区的发送时间送达。",
      now: "{offset} · 现在 {time}",
      saveFailed: "无法保存时区，请重试。"
    },
    email: {
      title: "每日复习邮件",
      desc: "每天几道练习题发送到你的邮箱——不附答案。",
      next: "下一封：{when}",
      todayAt: "今天 {time}",
      tomorrowAt: "明天 {time}",
      questionsPerEmail: "每封邮件的题目数",
      deliveryTime: "发送时间",
      inYourZone: "按你的时区：{zone}。",
      source: "题目来源",
      sources: {
        wrong: {
          title: "错题本",
          body: "你以前答错过的题目。"
        },
        bm: {
          title: "书签",
          body: "你收藏待看的题目。"
        },
        new: {
          title: "未做过",
          body: "你还没做过的题目。"
        }
      }
    },
    ai: {
      customModel: "自定义模型 ID…",
      errors: {
        noKey: "请先输入 API 密钥。",
        noPassphrase: "请设置一个用于加密密钥的口令。",
        saveFailed: "无法保存加密后的密钥。",
        unlockFailed: "口令错误，或没有已保存的密钥。"
      },
      storage: {
        memory: "仅保存在内存中（默认）",
        memoryShort: "仅内存",
        memoryBody: "刷新或关闭标签页后立即清除，不会写入磁盘。",
        encrypted: "加密保存在此浏览器",
        encryptedBody: "以 AES-GCM 密文存放在 IndexedDB 中，每次访问时用口令解锁。"
      },
      status: {
        loaded: "本次会话已加载密钥",
        locked: "解锁已保存的密钥",
        changing: "修改密钥设置",
        settingUp: "正在设置密钥",
        notSetUp: "尚未设置"
      },
      manage: "管理",
      provider: "服务商",
      model: "模型",
      keyStorage: "密钥存储",
      passphrase: "口令",
      choosePassphrase: "设置一个口令",
      passphraseHint: "使用 AES-GCM 加密，只保存在此浏览器中。我们无法找回口令——忘记口令后，保存的密钥也就无法使用了。",
      unlock: "解锁",
      useDifferentKey: "使用其他密钥",
      forgetKey: "删除已保存的密钥",
      stepConfigure: "配置",
      stepKey: "密钥",
      stepOf: "第 {step} 步，共 {total} 步",
      exactModel: "准确的模型 ID",
      continue: "继续",
      pasteKey: "粘贴你的 {provider} 密钥",
      pasteKeyDesc: "只发送到本应用的服务器，每次请求转发一次，从不保存。",
      apiKey: "API 密钥",
      replaceKey: "替换 API 密钥",
      saveEncrypt: "保存并加密",
      loadKey: "加载密钥",
      clearKey: "清除已加载的密钥",
      note: "你的密钥只会发送到本应用自己的服务器，由它针对单次请求转发给 {provider}，且从不保存。"
    },
    mcp: {
      title: "MCP 访问",
      desc: "用于把 AI 客户端（Claude、ChatGPT 等）通过 MCP 连接到你的 PrepDeck 学习数据的个人访问令牌。每个令牌都代表你本人操作，可随时撤销。",
      namePlaceholder: "例如 claude-desktop"
    },
    connections: {
      title: "已连接的应用",
      desc: "你通过 Google 登录并批准访问（而非使用令牌）连接的 AI 客户端。每个应用都以你批准的权限代表你操作，直到你断开连接。"
    }
  },
  mcp: {
    tokens: {
      created: "创建于 {when}",
      neverUsed: "从未使用",
      lastUsed: "最近使用：{when}",
      expired: "已于 {when} 过期",
      expires: "将于 {when} 过期",
      neverExpires: "永不过期",
      loadFailed: "无法加载令牌。",
      nameRequired: "名称为必填项。",
      createFailed: "无法创建此令牌。",
      revokeConfirm: "撤销“{name}”？使用此令牌的所有程序都会立即失效。",
      revokeFailed: "无法撤销此令牌。",
      rotateConfirm: "轮换“{name}”？当前令牌会立即失效，并由新令牌取代。",
      rotateFailed: "无法轮换此令牌。",
      tokenCopied: "令牌已复制。",
      promptCopied: "设置提示词已复制。",
      setupIntro: "把设置提示词复制到你的 AI 聊天机器人中即可连接 PrepDeck。按提示在客户端中安全地输入你的令牌。",
      copySetupPrompt: "复制设置提示词",
      createButton: "+ 创建令牌",
      name: "名称",
      namePlaceholder: "例如 local-cli",
      expiration: "有效期",
      expiry: {
        never: "永不过期",
        days_other: "{count} 天",
        year: "1 年"
      },
      creating: "创建中…",
      create: "创建令牌",
      copyNow: "立即复制“{name}”——它不会再次显示",
      newToken: "新的 MCP 令牌",
      hide: "隐藏",
      show: "显示",
      copySetupPromptWithToken: "复制含令牌的设置提示词",
      includesSecret: "包含机密信息。粘贴后，你的令牌就会分享给所选的 AI 服务。",
      copyFailedToken: "无法复制到剪贴板。请选中下方的令牌并手动复制。",
      copyFailedPrompt: "无法复制到剪贴板。请选中下方的设置提示词并手动复制。",
      copyManuallyToken: "需手动复制的令牌",
      copyManuallyPrompt: "需手动复制的设置提示词",
      empty: "还没有令牌。",
      status: {
        active: "有效",
        revoked: "已撤销",
        expired: "已过期"
      },
      rotate: "轮换",
      revoke: "撤销",
      rotating: "轮换“{name}”会让当前令牌立即失效，并签发一个新令牌。",
      completeCheck: "完成验证后再轮换。",
      rotateToken: "轮换令牌"
    },
    connections: {
      readWrite: "读写",
      readOnly: "只读",
      connected: "连接于 {when}",
      idle: "闲置太久——请从应用中重新连接",
      loadFailed: "无法加载已连接的应用。",
      thisApp: "此应用",
      disconnectConfirm: "断开 {name}？它会立即停止工作，需要重新连接才能恢复访问。",
      disconnectFailed: "无法断开此应用。",
      disabled: "此服务器已关闭新连接；现有连接在重新开启前也会暂停工作。",
      empty: "没有已连接的应用。",
      unnamed: "未命名应用",
      statusConnected: "已连接",
      statusExpired: "已过期",
      disconnect: "断开连接"
    },
    scopes: {
      userRead: {
        label: "读取你的学习数据",
        description: "考试、题目、你的作答记录、统计、批注和知识点。"
      },
      userWrite: {
        label: "记录学习活动并编辑你的笔记",
        description: "开始并作答练习、设置学习模式的进度，以及创建、编辑或删除你的知识点。"
      },
      adminRead: {
        label: "以管理员身份读取题库",
        description: "所有考试和题目、质量检查报告、统计、导出和导入预览。"
      },
      adminWrite: {
        label: "修改共享题库",
        description: "为所有用户创建、更新、归档和删除题目与考试，执行导入并编辑标签目录。"
      }
    },
    connect: {
      errors: {
        invalid_client: {
          title: "未知应用",
          body: "PrepDeck 无法识别把你带到这里的应用，因此没有建立任何连接。请返回该应用重新连接；如果问题持续出现，该应用可能不支持 PrepDeck 的登录方式。"
        },
        invalid_redirect_uri: {
          title: "无法返回该应用",
          body: "该应用要求返回到一个未注册的地址，因此 PrepDeck 在显示任何内容前就停止了。没有建立任何连接，请从应用中重新连接。"
        },
        invalid_request: {
          title: "无效的连接请求",
          body: "该应用的请求格式有误，因此没有建立任何连接。请从应用中重新连接。"
        },
        unavailable: {
          title: "暂不支持连接应用",
          body: "此 PrepDeck 服务器不接受 MCP 应用登录。如果应用支持，请改用“设置 → MCP 访问”中的个人访问令牌。"
        }
      },
      loadFailed: "PrepDeck 无法加载此连接请求。请刷新页面，或从应用中重新连接。",
      decideFailed: "操作未成功。请检查网络连接后重试。",
      ended: "此请求已结束",
      connected: "已连接",
      notConnected: "未连接",
      returning: "正在返回应用。如果没有反应，可以关闭此标签页并在应用中继续。",
      unnamedApp: "一个未命名的应用",
      title: "将 {app} 连接到 PrepDeck？",
      adminRequired: "需要管理员权限",
      actsAsYou: "它将以你的身份、按以下权限访问 {server}，直到你断开连接。",
      adminOnly: "{app} 请求访问 PrepDeck Admin MCP，只有在职管理员才能批准。请不连接直接返回应用。",
      app: "应用",
      unverified: "未验证",
      unverifiedTitle: "信息由应用自行声明；PrepDeck 未核实其发布者。",
      clientId: "客户端 ID {id}",
      returnsTo: "返回地址",
      server: "服务器",
      administrativeAccess: "管理权限",
      account: "账号",
      ableTo: "它将能够",
      trust: "只连接你信任的应用。你可以随时在{place}中断开它；退出 PrepDeck 登录并不会断开连接。",
      placeAdmin: "“管理 → MCP 令牌”",
      placeSettings: "“设置 → MCP 访问”",
      connecting: "连接中…",
      allow: "允许访问",
      returningShort: "返回中…",
      returnToApp: "返回应用"
    }
  },
  stats: {
    loading: "正在加载统计…",
    unavailable: "不可用",
    unavailableRetry: "不可用。请重试以加载此数据。",
    noExam: "未选择考试",
    noExamBody: "从考试切换器中选择一个考试，即可查看你的统计。",
    loadFailed: "无法加载{what}。本页其他内容不受影响。",
    failures: {
      statistics: "统计数据",
      activity: "学习活动",
      plan: "你的学习计划"
    },
    passed: "已通过",
    belowLine: "未达线",
    zoneTime: "{city}时间",
    signedPoints: "{sign}{count} 分",
    duration: {
      minutes: "{minutes} 分钟",
      hours: "{hours} 小时",
      hoursMinutes: "{hours} 小时 {minutes} 分钟"
    },
    header: {
      greeting: "很高兴见到你，{name}",
      greetingAnonymous: "很高兴见到你",
      tracking: "这是你今天 <exam>{name}</exam> 的备考进展。",
      chooseExam: "选择一个考试，查看你的备考进展。",
      continue: "继续练习",
      setUp: "设置练习"
    },
    countdown: {
      daysLeft_other: "考试 {date} · 还剩 {count} 天",
      today: "考试 {date} · 就是今天",
      passed: "考试 {date} · 已过"
    },
    plan: {
      title: "学习计划",
      loadFirst: "请先加载学习计划再进行编辑。",
      unavailable: "学习计划不可用",
      loading: "正在加载学习计划…",
      changeLabel: "{countdown}。修改你的学习计划。",
      setDate: "设置考试日期",
      saveFailed: "无法保存学习计划，请重试。",
      forExam: "适用于 {exam}。",
      forActive: "适用于当前考试。",
      optional: "两项都是可选的——清空字段即可删除。",
      examDate: "考试日期",
      invalidDate: "请输入有效的日期。",
      countdownHint: "按整天倒计时（{zone}）。",
      weeklyGoal: "每周学习目标（小时）",
      goalRange: "请输入 {min} 到 {max} 小时之间的数值。",
      goalHint: "以记录的学习时长（周一至周日）衡量。"
    },
    readiness: {
      title: "备考就绪度",
      noBank: "此考试还没有题目，暂无可衡量的内容。",
      noAttempts: "答几道题后，这里会显示就绪度估算。",
      smallSample: "就绪度至少需要 {min} 道已答题目；你目前答了 {answered} 道。在此之前这里只显示题库覆盖率。",
      thisExam: "此考试",
      noPassMark: "基于你已看过的 {subject} 中 {pct}% 题目的难度加权估算。此考试未设置及格线，因此没有可比较的基准。",
      above_other: "你比 {pass}% 的及格线高出 {count} 分。别让下面的薄弱标签掉队。",
      below_other: "你距离 {pass}% 的及格线还差 {count} 分。差距主要在下面的薄弱标签。",
      ringReady: "就绪",
      ringCovered: "已覆盖",
      ringAriaReady: "就绪度",
      ringValue: "就绪度 {pct}%",
      ringValuePass: "就绪度 {pct}%，及格线为 {pass}%",
      ringUnavailable: "暂无就绪度。题库覆盖率为 {pct}%。",
      method: "难度加权算法 v{version}，基于 {questions} 道题的 {answers} 次作答。并非对考试分数的预测。",
      covered: "题库覆盖率",
      coverageValue: "{seen} / {total} · {pct}%",
      emptyBank: "此题库还没有题目",
      coverageAria: "题库覆盖率 {pct}%",
      noWeakTags: "没有哪个标签既有足够的已答题目可供判断，又有剩余题目可练。",
      practises: "练习 {tags}",
      practiceWeak: "练习薄弱标签",
      startMock: "开始模拟考试"
    },
    first: {
      kicker: "开始吧",
      title: "回答你的第一批题目",
      titleCount: "回答你的前 {count} 道题",
      about: "大约 {count} 分钟，从你没见过的题目中抽取。",
      noneLeft: "没有可抽取的未做题目。",
      fillIn: "有了作答数据后，正确率、趋势图和你最薄弱的领域就会显示出来。",
      start: "开始答题",
      startCount: "开始 {count} 道题",
      learn: "先看带答案的题目"
    },
    answered: {
      label: "已答",
      suffix: "/ {total}",
      footer: "{days} 天内新增 {added} 道 · {unseen} 道未看",
      progress: "已答题库的 {pct}%"
    },
    accuracy: {
      label: "正确率",
      notMeasured: "尚未统计",
      notMeasuredPass: "尚未统计 · 及格线 {pass}%",
      answersNoPass_other: "{count} 次作答 · 未设置及格线",
      answersVsPass_other: "{count} 次作答 · 及格线 {pass}%"
    },
    wrongBook: {
      label: "错题本",
      suffix: "道",
      empty: "还没有错题",
      footer: "{repeated} 道错过不止一次 · 近 7 天 {recent} 道",
      strip: "{saved} 道未掌握的题目，其中 {repeated} 道错过不止一次"
    },
    bestMock: {
      label: "模考最佳",
      footer_other: "{date} · 共 {count} 次",
      empty: "还没有完成的模拟考试",
      bars: "最近 {count} 次模拟考试的得分：{scores}"
    },
    focus: {
      title: "重点关注",
      status: {
        weakest: "最薄弱",
        belowLine: "未达线",
        onTrack: "达标",
        notMeasured: "未统计 · 需要 {count} 次作答"
      },
      mix: {
        mostlyHard: "以难题为主",
        mediumHeavy: "以中等题为主",
        mostlyEasy: "以简单题为主",
        mixed: "难度混合"
      },
      wrong: "{count} 道错题",
      unseen: "{count} 道未看",
      nothingLeft: "没有可练习的题目了",
      notRanked: "尚未排名：每个标签需要 {count} 次作答才会统计。在此之前，可练题目最多的标签排在前面。",
      ranked: "最薄弱的标签在前，难题加权",
      rankedPass: "最薄弱的标签在前，难题加权，对照 {pass}% 的及格线",
      showTop: "只看前几个标签",
      viewAll: "查看全部 {count} 个标签",
      empty: "此题库还没有带标签的题目，暂无可排名的内容。",
      meterUnmeasured: "{tag}：作答次数不足，无法统计正确率",
      meter: "{tag}：{count} 次作答，正确率 {pct}%",
      allPractisedTitle: "{tag} 的所有题目都已作答，错题本中也没有它的题目。",
      allPractised: "已全部练过",
      practice: "练习 {count} 道"
    },
    trend: {
      title: "正确率趋势",
      loading: "正在加载正确率趋势…",
      summary_other: "最近 {count} 个活跃日的正确率，从 {fromDay} 的 {from}% 到 {toDay} 的 {to}%。",
      noPassMark: "此考试未设置及格线。",
      passLineIs: "及格线为 {pass}%。",
      empty: "还没有完成的作答，暂无正确率趋势。",
      subtitle_other: "最近 {count} 个活跃日（按{zone}计算日期）",
      needsAnswer: "至少需要一次完成的作答",
      passLine: "及格线",
      completeSession: "完成一次练习或模拟考试后，趋势就会显示在这里。",
      latest: "最近 {pct}%",
      latestNoPass: "此考试未设置及格线",
      aboveLine: "高于及格线",
      belowLine: "低于及格线",
      caption: "按活跃日统计的正确率"
    },
    studyTime: {
      title: "学习时长",
      loading: "正在加载学习时长…",
      summaryEmpty: "本周还没有完成的学习。",
      summary_other: "本周共 {count} 次学习，记录时长 {time}。",
      summaryGoal: "每周目标为 {goal}。",
      summaryNoGoal: "未设置每周目标。",
      summaryGoalUnavailable: "每周目标不可用。",
      summaryMissing_other: "{count} 次学习没有记录时长。",
      ofGoal: "{time} / 每周目标 {goal}",
      recorded: "本周记录 {time}",
      goalUnavailable: "每周目标不可用",
      goalLoading: "正在加载每周目标…",
      goalPct: "完成目标的 {pct}%",
      setGoal: "设置每周目标",
      sessions_other: "{count} 次学习",
      noDurations: "没有记录学习时长",
      average: "平均 {time}",
      longest: "最长 {day} · {time}",
      footnote: "记录的学习时长，按{zone}从周一到周日计算。",
      footnoteMissing_other: "{count} 次学习没有记录时长，显示为“?”。",
      caption: "本周每天记录的学习时长"
    },
    table: {
      show: "查看数据",
      empty: "暂无数据。",
      day: "日期",
      date: "日期",
      answers: "作答",
      correct: "正确",
      sessions: "学习次数",
      recordedTime: "记录时长"
    },
    heatmap: {
      day_other: "{date}：{count} 道题",
      noPractice: "{date}：未练习",
      less: "少",
      more: "多"
    },
    detail: {
      summary: "更多详情：难度、模考记录和长期活动",
      byDifficulty: "按难度",
      difficultyProgress: "{difficulty}：{pct}%",
      noAttempts: "还没有作答记录。",
      mockHistory: "模拟考试记录",
      completed: "完成时间",
      score: "得分",
      questions: "题数",
      result: "结果",
      noMocks: "还没有完成的模拟考试。",
      activity: "学习活动",
      activitySummary: "最近 {days} 天 · {active} 个活跃日 · {sessions} 次学习中有 {withDuration} 次记录了时长 · 平均每次 {minutes} 分钟"
    }
  },
  study: {
    question: "题目",
    questionN: "第 {n} 题",
    ofTotal: "共 {total} 题",
    yourAnswer: "你的答案",
    tabs: {
      explanation: "解析",
      notes: "笔记",
      related: "相关",
      history: "记录"
    },
    optionStatus: {
      yoursCorrect: "你的答案 · 正确",
      correct: "正确答案",
      yoursIncorrect: "你的答案 · 错误"
    },
    gate: {
      loadFailed: "无法加载此题，请重试。",
      loading: "正在加载题目…",
      retry: "重新加载题目",
      refresh: "刷新考试"
    },
    structured: {
      orderLegend: "按顺序选择每一项",
      matchLegend: "为每一项选择匹配项",
      position: "第 {n} 位",
      match: "{id} 的匹配项",
      select: "请选择…",
      correctResponse: "正确答案：{response}"
    },
    bookmark: "书签",
    tags: "标签",
    review: "复习",
    showMore: "展开",
    showLess: "收起",
    correct: "正确",
    incorrect: "错误",
    officialExplanation: "官方解析",
    studied: {
      label: "已学",
      markStudied: "标记为已学",
      markUnstudied: "标记为未学"
    },
    copyPrompt: {
      label: "复制为提示词",
      title: "将题目和答案复制为 Markdown 提示词",
      failed: "复制失败",
      copiedAnnounce: "Markdown 提示词已复制到剪贴板。",
      failedAnnounce: "无法复制 Markdown 提示词。"
    },
    underReview: {
      badge: "审核中",
      notice: "此题目前正在审核中，内容可能存在争议或不确定之处。"
    },
    options: {
      single: "答案选项，单选",
      multiple: "答案选项，可多选",
      review: "答案选项"
    },
    ai: {
      title: "AI 解析",
      cached: "已缓存",
      generated: "已生成",
      notCached: "未缓存",
      regenerate: "重新生成",
      relaying: "正在转发给 {provider}…",
      checking: "正在检查共享缓存…",
      alreadyExplained: "已有 <model>{name}</model> 生成的解析",
      showIt: "查看",
      noCached: "{provider} · {model} 还没有缓存的解析。",
      generate: "生成解析",
      noKey: "尚未加载 API 密钥。请在设置中添加，以生成新的解析。",
      addKey: "在设置中添加 API 密钥",
      unlockToGenerate: "解锁已保存的密钥以生成解析",
      unlocking: "解锁中…"
    },
    history: {
      emptyTitle: "还没有作答记录",
      emptyBody: "尚未在练习或模拟考试中作答。",
      mock: "模考",
      practice: "练习",
      answered: "作答 <answer>{value}</answer>"
    },
    revision: {
      title: "答案已修订",
      historical: "此结果反映的是作答时的答案。历史得分不变。",
      gradedKey: "评分时的答案：{key}。",
      legacy: "这次早期作答没有记录当时的答案。"
    },
    filters: {
      all: {
        label: "任意状态",
        desc: "已学和未学的题目都包括"
      },
      unstudied: {
        label: "仅未学",
        desc: "从未在学习模式中出现或作答过，或被标记为未学"
      },
      studied: {
        label: "仅已学",
        desc: "在学习模式中出现过，或在练习、模考中作答过"
      }
    }
  },
  notes: {
    emptyError: "题目笔记不能为空。",
    editNote: "编辑笔记",
    saveFailed: "无法保存。你的草稿已保留，请重试。",
    placeholder: "为这道题写条笔记…",
    forQuestion: "这道题的笔记",
    visibilityLabel: "笔记可见范围",
    save: "保存笔记",
    visibility: {
      private: "私有",
      shared: "共享",
      privateLabel: "私有",
      sharedLabel: "共享"
    }
  },
  setup: {
    questions_other: "{count} 道题",
    underReview: {
      title: "审核中的题目",
      desc_other: "此考试有 {count} 道题仍在审核中，内容可能存在争议或不确定之处。",
      include: "包含",
      includeDesc: "可以出现，并分别标注为审核中",
      skip: "跳过",
      skipDesc: "本次不包含这些题目"
    },
    studyStatus: {
      title: "学习状态",
      desc: "“已学”指在学习模式中出现过，或在练习、模考中作答过，并不代表已掌握。",
      unavailable: "无法加载你的学习状态，题目可能显示为未学。请刷新考试后重试。"
    },
    moreOptions: {
      title: "更多选项",
      desc: "可选。默认设置适合大多数情况。",
      hide: "收起",
      customize: "自定义"
    },
    difficulty: {
      label: "难度",
      desc: "按题目难度筛选。",
      any: "不限"
    },
    domains: {
      title: "领域",
      desc: "默认包含全部，除非你选择特定领域。",
      none: "此考试还没有领域。",
      searchPlaceholder: "搜索 {count} 个领域",
      search: "搜索领域",
      clearSearch: "清除搜索",
      filters: "领域筛选",
      noMatch: "没有与“{query}”匹配的领域。",
      showFewer: "收起",
      showAll: "显示全部 {count} 个领域",
      selectResults: "全选结果（{count}）",
      selected: "已选 {count} 个",
      selectResultsHint: "“全选结果”会替换你当前选择的领域。"
    },
    summary: {
      title: "本次概要",
      matches_other: "{count} 道题符合筛选条件",
      source: "来源",
      questions: "题目数",
      estimatedTime: "预计用时",
      minutes: "约 {count} 分钟",
      skipped: "已跳过",
      included: "已包含",
      start: "开始"
    }
  },
  practice: {
    setup: {
      title: "创建练习",
      intro: "不计时。选择题目来源和数量，然后开始。其他设置都是可选的。",
      source: "题目来源",
      sourceDesc: "选择要练习哪些题目。",
      count: "题目数量",
      countDesc: "选择 5–40 道题，每题约 {minutes} 分钟。",
      countPresets: "题目数量预设",
      feedback: "答案反馈",
      feedbackDesc: "选择何时查看答案和解析。",
      hiddenNote: "作答时会隐藏批注和笔记，题目判分后立即重新显示。"
    },
    shortcuts: {
      title: "键盘快捷键",
      selectOption: "选择选项",
      selectLetter: "按字母选择",
      check: "检查答案 / 下一题"
    },
    live: {
      correctCount: "{count} 道正确",
      incorrectCount: "{count} 道错误",
      noTimer: "不计时 · 每题反馈",
      checkCount: "检查答案（{chosen}/{need}）",
      check: "检查答案",
      finish: "完成",
      next: "下一题",
      end: "结束",
      endSession: "结束练习",
      incorrectAdded: "错误——已加入错题本",
      correctAnswer: "正确答案：{answer}。",
      explanationBelow: "解析已在下方展开。",
      explanationRight: "解析已在右侧展开。",
      lockedTitle: "解析和笔记已锁定",
      lockedBody: "检查答案后就会解锁，避免提前泄露答案。"
    },
    sources: {
      all: {
        label: "全部题目",
        desc: "此考试的完整题库"
      },
      new: {
        label: "未做过",
        desc: "你从未作答过的题目"
      },
      focus: {
        label: "未做过 + 错题",
        desc: "新题，加上你还没掌握的错题"
      },
      wrong: {
        label: "错题本",
        desc: "你还没掌握的错题"
      },
      bm: {
        label: "已加书签",
        desc: "你收藏待看的题目"
      }
    },
    emptySource: {
      all: {
        title: "此考试还没有题目",
        body: "题目添加到题库后会显示在这里。"
      },
      new: {
        title: "你已经做过所有题目",
        body: "题库中已经没有未做过的题目了。"
      },
      focus: {
        title: "没有新题或未掌握的题目了",
        body: "你已作答所有题目，错题本也已清空。"
      },
      wrong: {
        title: "你的错题本是空的",
        body: "在练习或模拟考试中答错的题目会保存在这里，直到你掌握为止。"
      },
      bm: {
        title: "还没有加书签的题目",
        body: "学习时给题目加上书签，它就会保存在这里。"
      }
    },
    feedback: {
      immediate: {
        label: "每题反馈",
        desc: "每次检查后查看答案和解析"
      },
      end: {
        label: "最后统一",
        desc: "先全部作答，再统一复习"
      }
    },
    difficulty: {
      any: "不限难度",
      easy: "仅简单",
      medium: "仅中等",
      hard: "仅困难"
    },
    empty: {
      practiceUnattempted: "练习未做过的题目（{count}）",
      practiceAll: "练习全部题目（{count}）",
      allStudiedTitle: "你已学完所有符合条件的题目",
      noneStudiedTitle: "你还没有学过符合条件的题目",
      allStudiedBody: "符合其他条件的题目都已在学习模式中出现过或作答过。在学习模式中把题目标记为未学，即可在这里再次练习。",
      noneStudiedBody: "符合其他条件的题目都还没有在学习模式中出现过或作答过。",
      practiceMatching_other: "练习全部 {count} 道符合条件的题目",
      noMatchTitle: "没有题目符合这些筛选条件",
      noMatchBody_other: "“{source}”有 {count} 道题，但没有符合你所选领域、难度、学习状态和审核设置的题目。",
      clearFilters: "清除领域、难度和学习状态筛选"
    },
    summary: {
      reviewSkipped: "跳过审核中题目",
      reviewIncluded: "包含审核中题目",
      feedback: {
        immediate: "每题反馈",
        end: "最后统一反馈"
      }
    }
  },
  learning: {
    live: {
      title: "第 {sequence} 号题",
      position: "第 {n} / {total} 题",
      exit: "退出",
      progress: "学习进度",
      jumpPlaceholder: "跳到 #",
      jumpLabel: "跳到指定题号",
      go: "前往",
      last: "最后一题",
      accepted: "可接受的答案"
    },
    setup: {
      title: "按顺序学习题库",
      intro: "直接显示答案，不评分。选择起点、按领域缩小范围，然后开始阅读。",
      allStudiedBody: "符合其他条件的题目都已在学习模式中出现过或作答过。学习时把题目标记为未学，即可在这里再次看到它。",
      learnMatching_other: "学习全部 {count} 道符合条件的题目",
      noMatchBody: "此考试没有符合你所选领域、难度、学习状态和审核设置的题目。",
      clearAll: "清除所有筛选",
      resumeTitle: "从上次停下的地方继续",
      resumeBody: "你上次学到第 {sequence} 号题。",
      resume: "继续",
      start: "起点",
      startDesc: "从这里开始按题号顺序显示。",
      startFrom: "从题号 # 开始",
      startFromRange: "从题号 # 开始（1–{max}）",
      numberingGaps: "题号是固定的题目编号，而不是位置：1 到 {max} 中有 {count} 个题号符合你的筛选条件。跳过的题号会从下一个开始。",
      startsAt: "起始题",
      begin: "开始学习",
      note: "每道题都会立即显示正确答案、你的作答记录、解析和笔记。不会评分，也不会加入错题本。显示过的题目会标记为已学，你也可以再标记为未学。"
    }
  },
  questionTypes: {
    chooseN: "选择 {count} 项",
    single: "单选",
    trueFalse: "判断",
    ordering: "排序",
    matching: "匹配",
    fillBlank: "填空"
  },
  pager: {
    label: "题目分页",
    page: "第 {current} / {pages} 页",
    goTo: "跳到页码",
    invalid: "请输入 1 到 {pages} 之间的整数页码。"
  },
  lists: {
    wrongTitle: "错题本",
    practiceThese: "练习这 {count} 道",
    saved: "已收藏",
    wrongTimes: "错 {count} 次 · {date}",
    removeBookmark: "移除书签",
    markMastered: "标记为已掌握",
    emptyBookmarksTitle: "还没有收藏",
    emptyBookmarksBody: "练习时给题目加上书签，它就会出现在这里。",
    emptyWrongTitle: "错题本已清空",
    emptyWrongBody: "所有答错的题目都已掌握，干得好！"
  },
  tagFilter: {
    label: "按标签筛选",
    resultOf_other: "{n} / {count} 道题",
    tagsSelected_other: "已选 {count} 个标签",
    allTags: "全部标签",
    clear: "清除筛选",
    searchPlaceholder: "搜索标签…",
    search: "搜索标签",
    noOtherMatch: "没有其他与“{query}”匹配的标签。",
    noMatch: "没有与“{query}”匹配的标签。",
    showMore: "再显示 {count} 个",
    hint: "选择多个标签时，会显示带有其中任一标签的题目。"
  },
  kp: {
    untitled: "未命名知识点",
    ungrouped: "未分组",
    groups: "分组",
    tags: "标签",
    unlink: "取消关联",
    reviewInLearning: "在学习模式中复习",
    reviewInLearningTitle: "在学习模式中打开以便复习，不会记录作答。",
    list: {
      sorts: {
        updated: "最近更新",
        title: "标题",
        created: "创建时间",
        custom: "自定义顺序"
      },
      justNow: "刚刚",
      updated: "更新于{when}",
      linkedQuestions_other: "关联 {count} 道题",
      noLinkedQuestions: "没有关联题目",
      screenshots_other: "{count} 张截图",
      diagrams_other: "{count} 张图表",
      note: "笔记",
      reorder: "用方向键或拖动调整“{title}”的顺序",
      moveUp: "上移“{title}”",
      moveDown: "下移“{title}”",
      acrossExams: "适用于所有考试",
      intro: "你自己撰写和整理的概念笔记。仅你可见——可以关联到任何考试中的题目。",
      new: "新建知识点",
      scopeAll: "全部个人知识点",
      scopeExam: "与此考试相关",
      allNotes: "全部笔记",
      matchesAll: "需同时匹配",
      search: "搜索标题和笔记正文…",
      results_other: "{count} 条结果",
      reload: "重新加载笔记",
      reorderOffExam: "在按考试筛选的视图中无法调整顺序。",
      reorderOffFilter: "搜索或标签筛选生效时无法调整顺序。",
      showAllToReorder: "显示全部笔记以调整顺序",
      clearToReorder: "清除筛选以调整顺序",
      emptyTitle: "还没有知识点",
      emptyBody: "每个概念写一篇讲解，关联它涉及的题目，就成了你自己的复习提纲。",
      createFirst: "创建第一篇笔记",
      noSearchMatch: "没有与“{query}”匹配的笔记",
      noTagMatch: "没有符合这些标签的笔记",
      noExamNotes: "还没有关联到此考试的笔记",
      tryDifferent: "换个关键词搜索，或清除筛选条件。",
      linkOrBrowse: "把知识点关联到此考试的题目，或浏览你的全部笔记。",
      resetFilters: "重置筛选",
      viewAll: "查看全部个人知识点",
      loadMore: "加载更多笔记",
      loadAllToReorder: "请先加载整个分组，再调整复习顺序。",
      customHint: "自定义顺序 · 拖动手柄，或在手柄上按空格再用方向键，也可以使用移动按钮。"
    },
    editor: {
      waitingImage: "等待图片上传…",
      notSaved: "未保存",
      saved: "已保存",
      savedAt: "已保存 · {time}",
      unsaved: "有未保存的更改",
      leaveFailed: "无法保存你的笔记，请重试后再离开。",
      retryLoad: "重新加载笔记",
      loading: "正在加载笔记",
      copied: "Markdown 已复制",
      copyFailed: "无法复制。请切换到 Markdown 模式选中文本。",
      titleLabel: "知识点标题",
      titleRequired: "必须填写标题才能保存这篇笔记。",
      removeTag: "移除标签 {name}",
      previousIn: "{group}中的上一篇",
      nextIn: "{group}中的下一篇",
      focusMode: "专注模式",
      focusModeTitle: "专注模式：隐藏侧边栏",
      moreActions: "更多操作",
      copyMarkdown: "复制为 Markdown",
      download: "下载 .md 文件",
      deleteNote: "删除笔记…",
      conflictTitle: "在你编辑期间，这篇笔记已在其他标签页或设备上被保存。",
      conflictBody: "保留本地修改（覆盖另一处的保存），或重新加载最新版本（放弃你的修改）。",
      reloadLatest: "加载最新版本",
      keepMine: "保留我的版本",
      saveFailed: "保存失败。",
      textSafe: "你的文字仍在编辑器中，不会丢失。",
      discardMetadata: "放弃失败的元数据修改",
      retryNow: "立即重试",
      details: "笔记详情",
      onThisPage: "本页目录",
      outline: "大纲",
      relatedQuestions: "相关题目",
      unavailable_other: "{count} 道关联题目已无法访问。",
      linkHint: "关联这篇笔记所讲解的题目，方便一起复习。",
      linkQuestion: "关联题目",
      meta: "创建于 {created} · 编辑于 {edited}",
      uploadingImage: "正在上传图片…",
      body: "知识点正文",
      imageRules: "请选择不超过 8 MB 的 PNG、JPEG 或 WebP 图片。",
      uploadFailed: "上传失败。你的文字已保留。",
      linkInvalid: "请使用 https、http、mailto 或相对链接。",
      imageFailed: "无法添加图片。",
      retryUpload: "重新上传",
      dismissUpload: "取消上传",
      placeholder: "开始写作。输入 <kbd>/</kbd> 插入表格、图片和图表，或直接粘贴 Markdown。",
      sourceHint: "这就是实际保存的内容。可以随时切回可视模式，不会丢失任何内容。",
      source: "Markdown 源码",
      drop: "拖放到这里添加图片",
      dropRules: "PNG、JPEG 或 WebP，最大 8 MB",
      insertBlock: "插入块",
      blocks: "块",
      slashMove: "移动",
      slashInsert: "插入",
      slashKeep: "保留为文字",
      editLink: "编辑链接",
      linkUrl: "链接 URL",
      linkUrlHint: "https、http、mailto 或相对链接",
      removeLink: "移除链接",
      apply: "应用",
      formatSelection: "设置所选文字格式",
      italic: "斜体",
      inlineCode: "行内代码",
      linkShortcut: "链接 · {shortcut}",
      tableControls: "表格操作",
      addRow: "添加行",
      addColumn: "添加列",
      removeRow: "删除行",
      removeColumn: "删除列",
      removeTable: "删除表格",
      words_other: "{count} 字",
      readingTime_other: "阅读约需 {count} 分钟",
      hintBlocks: "插入块",
      hintLink: "链接",
      hintMarkdown: "支持 Markdown 快捷输入"
    },
    manage: {
      title: "分组与标签",
      intro: "分组是扁平的——一篇笔记最多属于一个分组。标签可以自由重叠。两者都仅你可见，与题库的标签相互独立。",
      rename: "重命名 {name}",
      renameButton: "重命名",
      notes_other: "{count} 篇笔记",
      onNotes_other: "用于 {count} 篇笔记",
      groupCount_other: "{count} 个分组",
      createFailed: "无法创建分组",
      deleteGroupConfirm_other: "删除“{name}”？其中的 {count} 篇笔记会移到“未分组”，并保留内容、标签和题目关联。",
      builtIn: "内置",
      newGroup: "新分组名称",
      addGroup: "添加分组",
      groupRules: "名称必须唯一且不能为空。删除分组会把其中的笔记按原顺序移到“未分组”。",
      caseInsensitive: "不区分大小写",
      deleteTagConfirm_other: "删除标签“{name}”？它会从 {count} 篇笔记中移除——笔记本身不受影响。",
      noTags: "还没有标签——可以在笔记中添加。",
      tagRules: "重命名会更新所有使用该标签的笔记。删除只会移除关联——笔记会保留。"
    },
    delete: {
      label: "删除知识点",
      title: "删除“{title}”？",
      removes: "这将删除{items}。",
      theNote: "这篇笔记",
      itsScreenshots_other: "其中的 {count} 张截图",
      itsLinks_other: "与 {count} 道题的关联",
      kept: "题目和你的标签不会被删除。",
      keptWithGroup: "题目、“{group}”分组和你的标签不会被删除。",
      failed: "无法删除这篇笔记，请重试。",
      confirm: "删除笔记"
    },
    groupPicker: {
      group: "分组",
      label: "分组：{name}",
      moveTo: "移到分组",
      newGroup: "新分组",
      newGroupEllipsis: "新分组…",
      namePlaceholder: "分组名称",
      hint: "创建后，这篇笔记会移入该分组。",
      enterName: "请输入分组名称。",
      tooLong: "分组名称最多 {max} 个字符。",
      exists: "已存在名为“{name}”的分组。"
    },
    tagPicker: {
      add: "添加标签",
      placeholder: "添加标签…",
      yours: "你的标签",
      create: "创建“{name}”"
    },
    link: {
      intro: "在你能访问的所有考试中按题目 ID 或文字搜索。",
      close: "关闭题目选择器",
      search: "搜索标题和题目文字…",
      allExams: "全部考试",
      matches: "{count} 条匹配 · 显示 {shown} 条",
      linked: "已关联",
      link: "关联",
      noQuestions: "没有匹配的题目。",
      reviewNote: "打开关联题目会进入复习——不会记录作答。",
      saveFailed: "无法保存题目关联。请根据笔记的保存状态重试。"
    },
    linkExisting: {
      title: "关联已有笔记",
      search: "搜索你的知识点…",
      none: "没有匹配的知识点。",
      failed: "无法关联这篇笔记，请重试。"
    },
    related: {
      linkExisting: "关联已有",
      newNote: "+ 新建笔记",
      reload: "重新加载相关笔记",
      empty: "还没有知识点引用这道题。",
      loadFailed: "无法加载相关笔记，请重试。",
      createFailed: "无法创建并关联你的笔记。重试“新建笔记”即可继续使用同一份草稿。"
    },
    blocks: {
      h1: {
        title: "一级标题",
        hint: "大号章节标题"
      },
      h2: {
        title: "二级标题",
        hint: "中号章节标题"
      },
      h3: {
        title: "三级标题",
        hint: "小号章节标题"
      },
      bullets: {
        title: "无序列表",
        hint: "简单列表"
      },
      numbers: {
        title: "有序列表",
        hint: "按顺序的步骤"
      },
      quote: {
        title: "引用",
        hint: "提示框或考试要点"
      },
      table: {
        title: "表格",
        hint: "3 行 2 列，带表头"
      },
      image: {
        title: "图片",
        hint: "上传、粘贴或拖放 · PNG、JPEG 或 WebP，最大 8 MB"
      },
      code: {
        title: "代码块",
        hint: "等宽字体，保留空格"
      },
      diagram: {
        title: "图表",
        hint: "Mermaid 流程图"
      },
      divider: {
        title: "分隔线",
        hint: "章节之间的分隔线"
      }
    },
    toolbar: {
      label: "笔记格式",
      styles: {
        h0: "正文",
        h1: "一级标题",
        h2: "二级标题",
        h3: "三级标题"
      },
      textStyle: "文本样式",
      textStyleCurrent: "文本样式：{style}",
      locked: "请先完成或取消图片上传",
      link: "链接",
      insert: "插入",
      tip: "提示：在空行输入 <kbd>/</kbd>，无需离开键盘即可插入。",
      undo: "撤销",
      redo: "重做",
      mode: "编辑模式",
      visual: "可视"
    },
    paste: {
      pasted_other: "已将 {count} 个词作为格式化 Markdown 粘贴。",
      plain: "改为粘贴纯文本"
    },
    media: {
      enlarged: {
        image: "放大的图片",
        diagram: "放大的图表"
      },
      close: {
        image: "关闭放大的图片",
        diagram: "关闭放大的图表"
      }
    },
    blocksView: {
      unsupported: "不支持的 Markdown——可编辑源码",
      unsupportedSource: "不支持的 Markdown 源码",
      language: "语言",
      codeLanguage: "代码语言",
      codeSource: "代码源码",
      editDiagram: "编辑图表源码",
      previewDiagram: "预览图表",
      viewLargerImage: "查看大图",
      badImageUrl: "不支持此图片 URL。",
      altText: "替代文字",
      imageAltText: "图片替代文字",
      removeImage: "删除图片"
    },
    diagram: {
      tooLarge: "图表太大。最多 12,000 个字符、250 行。",
      failed: "图表渲染失败",
      didNotRender: "图表未能渲染——{error}",
      preview: "预览",
      source: "源码",
      viewLarger: "查看大图"
    }
  },
  errors: {
    requestFailed: "请求 {path} 失败（{status}）",
    ai: {
      noKey: "请先在设置中输入 API 密钥。",
      generateFailed: "无法生成解析。"
    },
    annotations: {
      saveNote: "无法保存批注笔记，请在离开前重试。",
      delete: "无法删除批注，请重试。"
    },
    question: {
      changed: "这道题已有变动。请刷新考试后重试。",
      loadFailed: "无法加载这道题。"
    },
    learning: {
      position: "无法保存你的学习进度，请重新跳转。",
      studyStatus: "无法保存这道题的学习状态，请重试。"
    },
    mock: {
      start: "无法开始这次模拟考试，请重试。",
      answerPending: "模考答案尚未保存，将在切换或交卷前重试。",
      timeUp: "时间到。这次模拟考试已按截止前保存的答案交卷。",
      alreadySubmitted: "这次模拟考试已在其他标签页或设备上交卷，现在显示其结果。",
      answerRejected: "这个答案无法保存，因此保留你最后保存的答案。题目可能已有变动，请刷新查看当前版本。",
      flagPending: "模考标记尚未保存，将在切换或交卷前重试。",
      submit: "无法提交这次模拟考试。你的答案已保留，请重试。"
    },
    nav: {
      noteFirst: "切换前请先保存或放弃你的题目笔记。",
      cancelled: "由于无法保存你的修改，跳转已取消。请重新保存。",
      examUnavailable: "此考试不可用，请选择其他考试。",
      switchConfirm: "切换学习内容？练习答案会被保存并结束本次练习。模考答案会被保存以便继续，计时不会停止。",
      saveBeforeSwitch: "无法保存你的进度，请在切换前重试。",
      saveNote: "无法保存当前笔记，请在离开前重试。",
      examNotAvailable: "你无法访问该考试。",
      switchFailed: "无法切换：{reason}。你的进度已保留，请重新保存或切换。"
    },
    practice: {
      start: "无法开始练习，请重试。",
      ended: "本次练习已结束，因此这个答案没有保存。之前的答案仍保留；请开始新的练习以继续。",
      answer: "无法保存你的答案，请重新提交。",
      note: "无法保存题目笔记。你的草稿已保留，请在切换题目前重试。",
      finish: "无法结束本次练习，请重试；你的练习进度已保留。",
      bookmark: "无法保存书签更改，请重试。",
      mastered: "无法将这道题标记为已掌握，请重试。"
    },
    notes: {
      save: "无法保存你的笔记。草稿已保留，请重试。",
      delete: "无法删除这条笔记，请重试。"
    },
    appearance: {
      invalid: "外观设置响应无效，请刷新后重试。",
      unavailable: "站点外观设置不可用"
    },
    workspace: {
      refreshExams: "无法刷新考试列表。你当前的进度已保留，请重试。",
      loadExams: "无法加载你的考试，请重试。",
      selectedGone: "所选考试已不可用。请选择一个可用的考试以继续。",
      switchUnavailable: "此考试不可用。你的进度已保留，请重新保存并切换到可用的考试。",
      linkedUnavailable: "你无法访问链接中的考试，已为你打开另一个考试。",
      previousUnavailable: "你之前的考试已不可用，已为你选择一个可用的考试。",
      refreshExam: "无法刷新此考试。你当前的进度已保留，请重试。",
      loadExam: "无法加载此考试，请重试。",
      linkedQuestionGone: "链接中的题目已不可用。",
      noSuchQuestion: "此考试没有第 {sequence} 号题。"
    },
    kp: {
      resolveConflict: "保存前请先解决版本冲突。",
      saveFailed: "保存失败，请重试。",
      composing: "离开前请先完成文字输入。",
      unsaved: "你的笔记还有未保存的更改。请在离开前重新保存。",
      loadNote: "无法加载这篇笔记。请重试或返回列表。",
      loadNotes: "无法加载你的笔记，请重试。",
      loadMore: "无法加载更多笔记，请重试。",
      stillMoving: "上一次移动仍在保存中。请等待完成后再试。",
      cannotReorder: "此视图无法调整顺序。请打开单个分组并使用自定义排序来调整。",
      orderChanged: "顺序已在其他标签页中改变。已加载最新顺序，请重新移动。",
      orderFailed: "无法保存新的顺序。之前的顺序已保留，请重试。",
      uploadFailed: "图片上传失败。离开前请重试或取消上传。"
    },
    avatar: {
      type: "请选择 JPEG、PNG 或 WebP 图片。",
      read: "无法读取此图片文件。",
      process: "无法处理此图片。",
      tooLarge: "即使压缩后图片仍然太大——请选择更小的文件。"
    }
  },
  admin: {
    header: {
      eyebrow: "管理工作区",
      title: "访问与内容",
      intro: "邀请在这里学习的人，并让考试内容库保持整洁。"
    },
    tabs: {
      label: "管理分区",
      overview: "概览",
      users: "成员",
      exams: "内容",
      mcp: "MCP 令牌",
      appearance: "外观"
    },
    count: {
      exams_other: "{count} 个考试",
      questions_other: "{count} 道题"
    },
    mcp: {
      title: "管理员 MCP 令牌",
      desc: "供需要题库管理权限的管理端 AI 客户端（如 local-codex、chatgpt-admin）使用的特权令牌。它们与用户 MCP 令牌相互独立，不能当作用户令牌使用。",
      namePlaceholder: "例如 local-codex",
      connectionsTitle: "已连接的管理应用",
      connectionsDesc: "你通过登录并批准管理权限连接到 Admin MCP 的客户端。一旦你断开连接或不再是管理员，它们会立即失去访问权限。"
    },
    status: {
      checking: "正在检查状态…",
      checkingDetail: "正在加载管理概览。",
      unavailable: "状态不可用",
      failedDetail: "管理概览加载失败：{message}",
      slow: "响应缓慢",
      slowDetail: "管理概览用时超过 {seconds} 秒（{time}）。",
      ok: "运行正常",
      okDetail: "管理概览已于 {time} 加载。"
    },
    overview: {
      requestFailed: "请求未完成。",
      loadFailed: "无法加载概览。",
      kicker: "一览",
      title: "工作区概览",
      intro: "你的 PrepDeck 工作区的实时统计。",
      activeLearners: "活跃学员",
      authorizedTotal: "共授权 {count} 人",
      library: "题库",
      across: "覆盖 {exams}",
      attempts: "作答记录",
      allTime: "全部时间的活动",
      invites: "待接受的邀请",
      revoked: "{count} 个已撤销访问",
      coverage: "内容覆盖",
      byExam: "各考试题目数",
      manageContent: "管理内容",
      noExams: "还没有考试。",
      quick: "快捷操作",
      quickTitle: "你想做什么？",
      invite: "邀请成员",
      inviteDesc: "授予工作区访问权限",
      addExam: "添加考试",
      addExamDesc: "扩充内容库"
    },
    users: {
      loadFailed: "无法加载授权用户列表。",
      inviteFailed: "无法邀请此账号。",
      updateFailed: "无法更新此账号。",
      bulkFailed: "无法更新所选账号。",
      revokeConfirm: "撤销 {email} 的访问权限？历史数据会保留，之后可以通过“恢复”撤回此操作。",
      resetConfirm: "重置 {email} 的 Google 关联？下一个用此地址登录的 Google 账号将接管该账号及其所有数据。只有确认账号已合法转手时才这样做。",
      bulkRevokeConfirm_other: "撤销 {count} 个账号的访问权限？之后可以通过“恢复”撤回此操作。",
      search: "搜索成员",
      searchPlaceholder: "搜索成员…",
      filters: {
        all: "全部",
        active: "已激活",
        invited: "已邀请",
        revoked: "已撤销"
      },
      invitePeople: "邀请成员",
      makeAdmin: "设为管理员",
      makeUser: "设为普通用户",
      revokeAccess: "撤销访问权限",
      selectAll: "选择所有显示的成员",
      select: "选择 {email}",
      person: "成员",
      role: "角色",
      roleOf: "{email} 的角色",
      status: "状态",
      lastSignIn: "最近登录",
      you: "你",
      resetLink: "重置关联",
      resetLinkTitle: "解除这一行所对应的 Google 账号，让下一个用此地址登录的账号接管它",
      restore: "恢复",
      noMatch: "没有与“{query}”匹配的用户。",
      footnote: "受邀账号会在首次用 Google 登录时激活。撤销访问会保留全部历史数据，并且可以撤回。",
      inviteTitle: "邀请账号",
      inviteSubtitle: "访问权限从对方首次用 Google 登录时开始。",
      googleEmail: "Google 邮箱",
      tempPassword: "临时密码",
      tempPasswordPlaceholder: "可选——仅限开发/本地环境",
      tempPasswordHint: "仅在此部署使用邮箱 + 密码登录时使用。",
      createdInvited: "创建后状态为“已邀请”。",
      inviting: "邀请中…",
      sendInvite: "发送邀请"
    },
    exams: {
      loadFailed: "无法加载考试。",
      providersFailed: "无法加载考试机构。请重新打开“内容”以重试。",
      assignFailed: "无法更新考试机构的分配。",
      badgeAfterCreate: "考试已创建，但徽标上传失败：{reason}",
      uploadFailed: "上传失败",
      createFailed: "无法创建此考试。",
      archiveConfirm: "归档“{name}”？所有用户的练习/模考设置中都将不再显示它。",
      updateFailed: "无法更新此考试。",
      badgeFailed: "无法上传此徽标图标。",
      search: "搜索考试",
      searchPlaceholder: "搜索考试…",
      allProviders: "全部机构",
      new: "新建考试",
      newSubtitle: "Slug 用于导入和 URL——请保持稳定。",
      archived: "已归档",
      active: "使用中",
      questionsUnit_other: "道题",
      open: "打开",
      noMatch: "没有匹配的考试。",
      name: "名称",
      slug: "Slug",
      subject: "科目",
      subjectPlaceholder: "架构",
      language: "语言",
      badgeIcon: "徽标图标",
      badgeHint: "正方形 PNG / SVG",
      browse: "浏览",
      addQuestionsAfter: "创建后即可添加题目。",
      create: "创建考试",
      badge: "徽标",
      editDetails: "编辑详情",
      replaceBadge: "更换徽标",
      addBadge: "添加徽标",
      archive: "归档",
      unarchive: "取消归档",
      providersHint: "点击即可为此考试分配或取消分配。"
    },
    examSettings: {
      title: "编辑考试详情",
      subtitle: "徽标、考试机构、官方形式和归档需分别编辑。",
      nameRequired: "名称为必填项。",
      slugInvalid: "Slug：由连字符分隔的小写字母和数字组成，例如 aws-sap-c02。",
      passInvalid: "及格线为 0 到 100 之间的百分比。",
      saveFailed: "无法保存这些详情。",
      description: "描述",
      passMark: "及格线（%）",
      passUnused: "设置了官方考试形式后不使用此项：模考按该形式的正确率比例判定及格。",
      passHint: "模拟考试按此正确率判定及格。留空表示不设及格线。",
      slugWarning: "Slug 是此考试 URL 的一部分，也出现在已发送的每日复习邮件链接中，导入文件和集成也可能引用它。一旦修改，使用 <slug>{old}</slug> 的链接将失效。",
      slugConfirm: "将 Slug 改为 <slug>{next}</slug>",
      onlyChanged: "只会保存你修改过的字段。",
      noChanges: "尚未修改。",
      save: "保存详情"
    },
    format: {
      title: "官方考试形式",
      intro: "真实考试的题量、时限和及格线。模拟考试据此提供完整、半程和冲刺三种长度，并按相同的正确率比例判定及格。",
      replacesPass: "设置后将取代 {pass}% 的及格线。",
      fillAll: "请填写全部三项。",
      wholeNumbers: "请使用大于零的整数。",
      passTooHigh: "及格所需正确题数不能超过题目总数。",
      saveFailed: "无法保存考试形式。",
      passCount: "及格所需正确题数",
      save: "保存形式",
      saved: "已保存。",
      summary: "及格线 {pass}% · 每题 {minutes} 分钟。",
      notSet: "未设置——模拟考试只提供冲刺和自定义长度。"
    },
    providers: {
      title: "考试机构",
      manage: "管理考试机构",
      new: "新建考试机构",
      edit: "编辑考试机构",
      none: "还没有考试机构。",
      noneActive: "没有使用中的考试机构。",
      noneAtAll: "没有考试机构。",
      deleteConfirm: "永久删除“{name}”？此操作无法撤销。已分配给考试的机构不能删除，请改为归档。",
      updateFailed: "无法更新此考试机构，请重试。",
      editSubtitle: "考试机构用于在菜单和选择器中对考试分组。",
      manageSubtitle: "归档考试机构可在选择器中隐藏它，同时保留其考试和题目。",
      showArchived: "显示已归档的考试机构",
      iconRules: "请选择不超过 2 MB 的 JPEG、PNG 或 WebP 图标。",
      pleaseRetry: "请重试。",
      iconFailed: "考试机构已保存，但图标无法更新。",
      saveFailed: "无法保存考试机构。",
      shortName: "简称",
      website: "官方网址",
      icon: "图标",
      currentIcon: "当前机构图标",
      iconHint: "JPEG、PNG 或 WebP · 最大 2 MB",
      removeIcon: "移除当前图标",
      assignHint: "可在任意考试的详情页中分配考试。",
      save: "保存考试机构",
      add: "添加考试机构"
    },
    mascot: {
      title: "站点吉祥物",
      intro: "选择在整个 PrepDeck（包括登录页）中使用的吉祥物。此设置对所有人生效。",
      loading: "正在加载当前吉祥物…",
      current: "当前吉祥物：{style}",
      loadFailed: "无法加载当前吉祥物，仍显示最后可用的样式。",
      retry: "重新加载",
      style: "吉祥物样式",
      styles: {
        chibi3d: "3D Q 版",
        anime2d: "2D 动漫"
      },
      preview: "{style} 预览",
      currentStyle: "当前站点样式",
      previewShort: "预览",
      save: "保存吉祥物",
      saved: "吉祥物已为所有人更新。其他用户刷新或回到 PrepDeck 时就会看到。",
      saveFailed: "无法保存，请重试。",
      kept: "你的选择已保留，可以重新保存。"
    }
  },
  authoring: {
    types: {
      single_choice: "单选",
      multiple_choice: "多选",
      true_false: "判断",
      fill_blank: "填空",
      ordering: "排序",
      matching: "匹配"
    },
    typesInline: {
      single_choice: "单选题",
      multiple_choice: "多选题",
      true_false: "判断题",
      fill_blank: "填空题"
    },
    fields: {
      type: "题型",
      stem: "题干",
      options: "选项",
      correctAnswers: "正确答案",
      explanation: "官方解析",
      externalId: "外部 ID",
      difficulty: "难度",
      points: "分值",
      tags: "标签",
      needsReview: "需要审核"
    },
    list: {
      range: "第 {range} 道，共 {total} 道",
      export: "导出本页",
      exportFailed: "无法导出题目",
      import: "导入 JSON",
      add: "添加题目",
      searchLabel: "搜索题干或准确的内部 / 外部 ID",
      searchPlaceholder: "搜索题干或准确 ID…",
      filterType: "按题型筛选",
      allTypes: "全部题型",
      filterDifficulty: "按难度筛选",
      allDifficulties: "全部难度",
      filterTag: "按准确标签筛选",
      exactTag: "准确标签",
      filterReview: "按审核状态筛选",
      anyReview: "任意审核状态",
      needsReview: "需要审核",
      reviewed: "已审核",
      filterArchived: "按归档状态筛选",
      anyStatus: "任意状态",
      activeOnly: "仅使用中",
      archivedOnly: "仅已归档",
      bankEmpty: "此题库为空。添加一道题开始编写。",
      noMatch: "没有符合当前筛选条件的题目。",
      archivedAt: "已于 {when} 归档",
      archivedTag: "已归档",
      id: "ID：{id}",
      externalId: "外部 ID：{id}",
      archiveConfirm: "归档第 {sequence} 号题？学员将不会再在练习、模拟考试、学习模式或复习列表中看到它。作答、笔记等历史记录都会保留，你可以随时恢复。",
      archived: "已归档第 {sequence} 号题。",
      restored: "已恢复第 {sequence} 号题。",
      archiveFailed: "无法归档题目。",
      restoreFailed: "无法恢复题目。",
      deleteConfirm: "永久删除这道题？已有作答、书签、笔记或其他学习记录的题目不能删除，请改为归档。",
      deleted: "已删除第 {sequence} 号题。",
      deleteFailed: "无法删除题目。",
      saved: "已保存第 {sequence} 号题。",
      savedWithId: "已保存第 {sequence} 号题（{id}）。",
      imported: "导入完成。请在导入对话框中查看每道题的结果。"
    },
    editor: {
      editTitle: "编辑题目",
      close: "关闭题目编辑器",
      revision: "版本 {revision}",
      view: "题目视图",
      stale: "在你编辑期间，有人保存了这道题的更新版本。",
      saveFailed: "无法保存这道题。你的输入已保留。",
      discardLatestTitle: "放弃修改并加载最新版本？",
      discardLatestBody: "你未保存的修改将被最新保存的题目替换。",
      discardLatestAction: "放弃并加载最新版本",
      loadedRevision: "已加载版本 {revision}。",
      changedSince: "自你打开以来有变动的字段：{fields}。",
      editsKept: "你的修改已保留，请检查后再次保存。",
      loadLatestFailed: "无法加载最新版本。",
      loadLatestFailedReason: "无法加载最新版本：{reason}",
      changedType: "已改为{type}。{cleared}",
      clearedBoth: "选项和正确答案已清除。",
      clearedOptions: "选项已清除。",
      clearedAnswers: "正确答案已清除。",
      removedOption: "已删除选项 {id}。",
      removedCorrectOption: "已删除选项 {id}（正确答案）。",
      stemMarkdown: "题干 · Markdown",
      optionsAnswers: "选项和正确答案",
      selectAtLeastTwo: "请至少选择两个正确答案。",
      selectOne: "请选择一个正确答案。",
      option: "选项 {id}",
      correctAnswerFor: "正确答案 {id}",
      removeOption: "删除选项 {id}",
      optionMarkdown: "选项 {id} · Markdown",
      addOption: "添加选项",
      acceptedAnswers: "可接受的答案（每行一个）",
      blankLines: "空行会被忽略。",
      explanationMarkdown: "官方解析 · Markdown",
      externalIdLabel: "外部 ID（可选，在此考试中唯一）",
      needsReviewHelp: "审核状态保存在题目本身，而不是作为标签。导入时会设置它；题目核对完成后请清除。",
      markdownPreview: "Markdown 预览",
      yourEditsKept: "你的修改已保留。",
      loadKeep: "加载最新版本并保留我的修改",
      discardMine: "放弃我的修改",
      checkFields: "请检查标出的字段。你的输入已保留。",
      savedRevision: "已保存版本 {revision}，没有未保存的修改。",
      noUnsaved: "没有未保存的修改",
      saveAddNext: "保存并添加下一题"
    },
    component: {
      title: "编辑组件题",
      intro: "编辑结构化题目包。题目有效时预览会更新。",
      fields: {
        body: "题目正文",
        interaction: "作答交互",
        stimuli: "共享材料",
        assets: "资源",
        correctResponse: "正确答案",
        archive: "归档状态"
      },
      answerEditFailed: "无法在保留撤销记录的同时修改答案。你的源码已保留，请在 JSON 中编辑答案。",
      previousRestored: "已恢复上一版草稿。",
      nextRestored: "已恢复下一版草稿。",
      formatUndoFailed: "无法在保留撤销记录的同时格式化 JSON。你的源码已保留。",
      formatFailed: "无法格式化 JSON。你的源码已保留。",
      saveFailed: "无法保存题目",
      discardLatestBody: "你的原始 JSON 将被最新保存的题目替换。",
      changedSinceRevision: "自版本 {revision} 以来有变动的字段：{fields}。",
      noChangesSince: "自版本 {revision} 以来内容没有变动。",
      rawKept: "你的原始 JSON 已保留。",
      draftMatches: "你的草稿现已与最新保存的题目一致。",
      reviewThenSave: "检查题目后，准备好了再保存。",
      tryAgain: "请重试。",
      changed: "这道题已有变动。",
      view: "编辑视图",
      answerControls: "答案设置",
      formatJson: "格式化 JSON",
      packageJson: "题目包 JSON",
      packageErrors: "题目包错误",
      syntaxError: "JSON 语法错误：{message}",
      syntaxErrorAt: "JSON 语法错误，第 {line} 行第 {column} 列：{message}",
      validationErrors: "题目包校验错误：",
      preview: "组件题预览",
      previewStale: "预览已过时，显示的是最近一次有效的草稿。",
      previewNone: "还没有有效的预览。修正题目包错误后即可查看预览。",
      leftPreviewItems: "左侧预览项",
      rightPreviewItems: "右侧预览项",
      table: "题目表格",
      missingFigure: "缺少图片：{alt}"
    },
    answers: {
      label: "答案配置",
      sequence: "正确顺序",
      matches: "正确匹配",
      intro: "在这里修改正确答案。内容、ID 和结构请在 JSON 中编辑。",
      answer: "答案 {id}",
      idCode: "ID：<code>{id}</code>",
      moveUp: "上移 {id}",
      moveDown: "下移 {id}",
      up: "↑ 上移",
      down: "↓ 下移",
      moved: "{id} 已移到第 {position} 位（共 {total} 位）。",
      rightReuse: "右侧项可以使用多次，也可以不使用。",
      leftItems: "左侧项",
      rightItems: "右侧项",
      leftIdCode: "左侧 ID：<code>{id}</code>",
      rightIdCode: "右侧 ID：<code>{id}</code>",
      leftId: "左侧 ID：{id}",
      rightId: "右侧 ID：{id}",
      rightFor: "{id} 对应的右侧项",
      matchChanged: "{id} 的匹配已更改。",
      reasons: {
        tooLarge: "答案设置仅支持不超过 5 MiB 导入上限的题目包。请继续在 JSON 中编辑。",
        invalid: "答案设置需要一道有效的 schema 2.0 题目且不含重复键。请先在 JSON 中修正题目包错误。",
        duplicates: "存在重复键时无法使用答案设置。请在 JSON 中解决有歧义的对象属性。",
        unsupported: "答案设置仅支持排序题和匹配题。请在 JSON 中编辑这道题。",
        failed: "答案设置无法解析此源码。请继续在 JSON 中编辑。"
      }
    },
    json: {
      invalid: "JSON 语法无效。",
      unlocated: "请检查 JSON 语法；无法确定错误位置。",
      schemaVersion: "必须为 \"2.0\"",
      oneQuestion: "在此编辑器中必须恰好包含一道题",
      validateFailed: "无法校验此题目包。请检查结构后重试。",
      location: "第 {line} 行第 {column} 列",
      duplicateKey: "对象键 {name} 在{location}重复；首次声明于{first}。保存前请删除或重命名其中一个键。",
      duplicateLimit: "只显示前 50 个重复键。请修正后再检查。",
      duplicateFailed: "无法检查此题目包中的重复键。请减少嵌套层级后重试；你的源码已保留。",
      formatChanges: "无法在不改变内容的情况下格式化 JSON。你的源码已保留。",
      syntax: {
        InvalidSymbol: "意外的符号。请使用 JSON 值或标点。",
        InvalidNumberFormat: "JSON 数字无效。",
        PropertyNameExpected: "此处应为双引号括起的属性名。",
        ValueExpected: "此处应为 JSON 值。",
        ColonExpected: "属性名后应为冒号。",
        CommaExpected: "值或属性之间应为逗号。",
        CloseBraceExpected: "缺少右花括号（}）。",
        CloseBracketExpected: "缺少右方括号（]）。",
        EndOfFileExpected: "JSON 值之后出现了多余的内容。",
        InvalidCommentToken: "JSON 中不允许使用注释。",
        UnexpectedEndOfComment: "JSON 中不允许使用注释。",
        UnexpectedEndOfString: "此字符串缺少结尾的双引号。",
        UnexpectedEndOfNumber: "此数字不完整。",
        InvalidUnicode: "此字符串包含无效的 Unicode 转义。",
        InvalidEscapeCharacter: "此字符串包含无效的转义序列。",
        InvalidCharacter: "此字符串包含未转义的控制字符。"
      }
    },
    import: {
      title: "导入题目",
      intro: "新题目会追加到此考试中。除非你在下方明确应用导入的版本，现有内容都会保留。",
      pdfTitle: "从 PDF 准备题目",
      pdfBody: "使用 pdf-to-quiz 技能转换 PDF，对照原始页面核对题目和答案，然后在下方上传生成的 JSON。",
      capabilities: "支持的内容：{blocks}。作答交互：{interactions}。支持旧版和组件 JSON 导入。",
      schemasFailed: "无法加载 PDF 准备格式。你仍然可以导入已准备好的 JSON 文件。",
      schemasLoading: "正在加载 PDF 准备格式…",
      downloadSchemas: "下载转换 schema",
      file: "题目导入 JSON 文件",
      tooLarge: "导入文件不能超过 5 MiB。",
      validateFailed: "无法校验文件。",
      failed: "导入失败。请刷新预览后重试。",
      processing: "处理中…",
      incoming_other: "待导入 {count} 道题",
      conflicts_other: "{count} 处冲突",
      previewTitle: "预览导入的题目",
      previewNote: "最多显示五道题。导入前请检查完整的源文件。",
      current: "当前：{value}",
      incomingValue: "导入：{value}",
      ambiguous: "多道题共用这个外部 ID。请在编辑器中修正它们的 ID，然后重新校验导入。",
      resolution: "处理方式",
      keep: "保留当前版本",
      apply: "应用导入的版本",
      results: "导入结果",
      summary: "新建 {created} · 更新 {updated} · 跳过 / 冲突 {skipped} · 失败 {failed}",
      retryNote: "只需重试失败或冲突的记录。没有外部 ID 的题目每次导入都会作为新记录。",
      execute: "按所选方式导入"
    },
    guard: {
      title: "放弃未保存的修改？",
      body: "你对题目的修改尚未保存。放弃修改才能继续。",
      action: "放弃修改",
      keep: "继续编辑"
    },
    preview: {
      notSelected: "未选择",
      noAnswers: "正确答案：未选择"
    },
    tags: {
      lengthError: "请输入 1–{max} 个字符的标签名。",
      selected: "已选标签",
      placeholder: "搜索或创建标签…",
      available: "可用标签",
      alreadySelected: "已选择此标签。",
      loading: "正在加载标签…",
      none: "没有匹配的标签。输入名称即可创建。",
      hint: "选择已有标签或新建一个。修改会随题目一起保存。",
      limit: "每道题最多 {max} 个标签。请先移除一个再添加。",
      loadFailed: "无法加载标签。你仍然可以编辑这道题。",
      retry: "重新加载标签"
    },
    classifications: {
      filterBy: "按{label}筛选",
      unclassified: "未分类 / 有歧义（{count}）",
      loadFailed: "无法加载分类筛选。",
      retry: "重新加载筛选"
    }
  },
  annotations: {
    underline: "下划线",
    bold: "加粗",
    deleteMark: "删除标记",
    title: "我的批注",
    selectHint: "选中下方任意文字即可高亮、加下划线或加粗。",
    private: "标记仅你可见，作答时不会显示。",
    filter: "筛选：",
    clearFilter: "清除筛选",
    sort: "标记排序",
    oldest: "最早在前",
    newest: "最新在前",
    filterFailed: "无法应用此筛选，显示的标记可能不是最新的。",
    noMatchTitle: "没有符合此筛选的标记",
    noMatchBody: "你在此考试中的标记都没有使用所选的标记类型。",
    emptyTitle: "还没有批注",
    emptyBody: "在学习模式中，或在练习中检查答案、提交模拟考试后，选中题目中的文字即可高亮、加下划线或加粗。你的标记和题目笔记都会汇集在这里。",
    goLearning: "前往学习模式",
    marks_other: "{count} 个标记",
    markNote: "为这个标记添加备注…"
  },
  mock: {
    setup: {
      title: "模拟真实考试",
      intro: "计时、随机抽题，交卷前没有任何反馈。",
      requiredCorrect: "{total} 道中答对 {required} 道",
      notSet: "未设置",
      inProgress: "你有一场正在进行的考试",
      answered: "已答 {answered} / {total} 道。",
      answeredLeft_other: "已答 {answered} / {total} 道 · 服务器计时还剩 {count} 分钟。",
      resumeOrSubmit: "请继续作答，或先交卷再开始新的考试。",
      resume: "继续考试",
      format: "形式",
      formatDesc: "选择题量和时限。",
      formats: {
        full: "完整考试",
        half: "半程",
        sprint: "冲刺",
        custom: "自定义"
      },
      formatSize: "{count} 道题 · {minutes} 分钟",
      formatSizeFull: "{count} 道题 · {minutes} 分钟。与真实考试一致。",
      customDesc: "自行设置题量和时间",
      timeLimit: "时限（分钟）",
      countError: "请输入 1 到 {max} 之间的整数。",
      minutesError: "请输入 {min} 到 {max} 之间的整数分钟。",
      noOfficial: "管理员设置此考试的官方形式后，才会提供完整和半程考试。",
      howItWorks: "考试规则",
      rules: {
        random: {
          title: "随机抽题，不重复",
          desc: "题目从整个题库中抽取。"
        },
        noFeedback: {
          title: "交卷前没有反馈",
          desc: "想回头再看的题目，可以在交卷前标记。"
        },
        serverClock: {
          title: "服务器计时",
          desc: "关闭标签页后计时仍会继续。"
        },
        autosave: {
          title: "答案自动保存",
          desc: "网络中断也不会让这次考试作废。"
        }
      },
      summary: "考试概要",
      minutes: "分钟",
      pace: "节奏",
      paceValue: "每题 {minutes} 分钟",
      passMark: "及格线",
      shortBank_other: "此题库只有 {count} 道题，因此考试将使用全部题目。",
      shortBankPace_other: "此题库只有 {count} 道题，因此考试将以相同节奏使用全部题目。",
      shortBankSkipping_other: "排除审核中的题目后，此题库只有 {count} 道题，因此考试将使用全部题目。",
      shortBankSkippingPace_other: "排除审核中的题目后，此题库只有 {count} 道题，因此考试将以相同节奏使用全部题目。",
      allUnderReview: "此考试的所有题目都在审核中。请包含它们以开始考试。",
      resumeInProgress: "继续进行中的考试",
      begin: "开始考试"
    },
    live: {
      timeLeft: "还剩 {minutes} 分 {seconds} 秒",
      lowTime: "剩余不到 5 分钟",
      serverClock: "服务器计时 · 答案自动保存",
      answeredOf: "已答 {answered} / {total}",
      flag: "标记",
      flagged: "已标记",
      submitExam: "交卷",
      reviewSubmit: "检查并交卷",
      palette: "题目面板",
      answered: "已答",
      left: "剩余",
      notAnswered: "未答",
      answeredState: "已答",
      flaggedState: "已标记",
      stateSeparator: "，"
    },
    results: {
      nCorrect: "答对 {count} 道",
      above: "高出 {count} 道",
      short: "差 {count} 道",
      missed: "答错",
      unanswered: "{count} 道未作答",
      toReview: "待复习",
      timeUsed: "用时",
      minutes: "{count} 分钟",
      notPassed: "未通过",
      below: "低于及格线",
      aboveMark: "高于及格线",
      complete: "考试完成",
      heroSub: "用时 {minutes} 分钟 · {total} 道题 · 答对 {correct} 道",
      newMock: "新的模考",
      noMisses: "没有需要练习的错题",
      practiceMisses_other: "练习这 {count} 道错题",
      breakdown: "逐题分析",
      breakdownSub: "为值得回顾的题目加书签，或打开它的知识点。",
      filter: "筛选题目",
      filterAll: "全部 {count}",
      filterMissed: "答错 {count}",
      filterCorrect: "答对 {count}",
      domain: "领域",
      yours: "你的答案",
      actions: "操作",
      emptyView: "此视图中没有题目。",
      questionKps: "题目相关知识点"
    },
    submit: {
      title: "交卷吗？",
      answered_other: "你已作答 {answered} / {count} 道题。",
      answeredFlagged: "你已作答 {answered} / {total} 道题，并标记了 {flagged} 道。",
      warning: "未作答的题目按错误计分，交卷后不能再修改答案。",
      keepGoing: "继续作答",
      submit: "交卷"
    }
  }
};

export default messages;
