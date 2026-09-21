/**
 * Starter flow templates.
 *
 * Three pre-canned flows users can clone with one click instead of
 * building from scratch. Each template is a plain JS object describing
 * the same shape `/api/flows` PUT accepts — name, trigger config,
 * entry_node_id, fallback_policy, nodes[] — keyed by a stable
 * `slug`.
 *
 * The clone path (`/api/flows` POST with `template_slug`) creates a
 * NEW flow_row + flow_nodes rows for the user. `node_key`s are kept
 * verbatim (they're stable strings, not UUIDs, so cloning never
 * needs to rewrite edge references).
 *
 * Choosing a single static module over a DB-backed gallery for v1
 * because: (a) the set is small and changes with code releases, not
 * data; (b) keeps templates portable across self-hosted instances
 * without migrations; (c) editing in source is the lowest-friction
 * way to add the next template.
 */

import type {
  CollectInputNodeConfig,
  ConditionNodeConfig,
  HandoffNodeConfig,
  KeywordTriggerConfig,
  SendButtonsNodeConfig,
  SendListNodeConfig,
  SendMessageNodeConfig,
  StartNodeConfig,
} from "./types";

export type FlowTemplateNodeType =
  | "start"
  | "send_message"
  | "send_buttons"
  | "send_list"
  | "collect_input"
  | "condition"
  | "set_tag"
  | "handoff"
  | "end";

export interface FlowTemplateNode {
  node_key: string;
  node_type: FlowTemplateNodeType;
  /**
   * Human-readable display name shown in the editor (list + canvas).
   * Persisted into the node's `config.label` on clone so the UI can
   * render a friendly Chinese name instead of the raw `node_key`
   * slug. Optional — nodes without a label fall back to `node_key`.
   */
  label?: string;
  config:
    | StartNodeConfig
    | SendMessageNodeConfig
    | SendButtonsNodeConfig
    | SendListNodeConfig
    | CollectInputNodeConfig
    | ConditionNodeConfig
    | HandoffNodeConfig
    | Record<string, unknown>;
}

export interface FlowTemplate {
  slug: string;
  name: string;
  description: string;
  /** Used by the gallery to surface a relevant icon. lucide-react name. */
  icon: "MessageSquare" | "HelpCircle" | "UserPlus";
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: KeywordTriggerConfig | Record<string, unknown>;
  entry_node_id: string;
  nodes: FlowTemplateNode[];
}

// ============================================================
// 1. Welcome menu — the example from the owner's brief
// ============================================================
const WELCOME_MENU: FlowTemplate = {
  slug: "welcome_menu",
  name: "欢迎菜单",
  description:
    "向发送关键词的客户问好，并根据其是新客户还是老客户，将其转接给合适的客服。",
  icon: "MessageSquare",
  trigger_type: "keyword",
  trigger_config: { keywords: ["支持", "帮助", "你好"], match_type: "contains" },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      label: "开始",
      config: { next_node_key: "欢迎语" },
    },
    {
      node_key: "欢迎语",
      node_type: "send_buttons",
      label: "欢迎语",
      config: {
        text: "你好！👋 欢迎咨询。请问你是老客户还是新客户？",
        footer_text: "点击下方按钮继续。",
        buttons: [
          {
            reply_id: "existing",
            title: "老客户",
            next_node_key: "老客户转接",
          },
          {
            reply_id: "new",
            title: "新客户",
            next_node_key: "新客户转接",
          },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "老客户转接",
      node_type: "handoff",
      label: "老客户转接",
      config: {
        note: "老客户需要协助——回复前请先查看其账户历史。",
      } as HandoffNodeConfig,
    },
    {
      node_key: "新客户转接",
      node_type: "handoff",
      label: "新客户转接",
      config: {
        note: "新客户——发送价格信息和引导链接。",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// 2. FAQ bot — list-message answers, fully automated
// ============================================================
const FAQ_BOT: FlowTemplate = {
  slug: "faq_bot",
  name: "常见问题机器人",
  description:
    "自动回答常见问题。客户从列表选主题，机器人回复答案并结束。",
  icon: "HelpCircle",
  trigger_type: "keyword",
  trigger_config: {
    keywords: ["常见问题", "咨询", "信息"],
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      label: "开始",
      config: { next_node_key: "选择主题" },
    },
    {
      node_key: "选择主题",
      node_type: "send_list",
      label: "选择主题",
      config: {
        text: "请问你需要什么帮助？",
        button_label: "查看主题",
        sections: [
          {
            title: "常见问题",
            rows: [
              {
                reply_id: "hours",
                title: "营业时间",
                next_node_key: "回复营业时间",
              },
              {
                reply_id: "pricing",
                title: "价格咨询",
                next_node_key: "回复价格",
              },
              {
                reply_id: "refunds",
                title: "退款政策",
                next_node_key: "回复退款",
              },
            ],
          },
          {
            title: "其他",
            rows: [
              {
                reply_id: "human",
                title: "转人工",
                next_node_key: "转人工",
              },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: "回复营业时间",
      node_type: "send_message",
      label: "回复营业时间",
      config: {
        text: "我们的营业时间是周一至周五 9:00–18:00（当地时间）。周末仅处理紧急问题。",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "回复价格",
      node_type: "send_message",
      label: "回复价格",
      config: {
        text: "我们的价格每月 9 美元起。访问 https://example.com/pricing 查看完整价格说明。",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "回复退款",
      node_type: "send_message",
      label: "回复退款",
      config: {
        text: "购买后 30 天内可申请退款。请回复你的订单号，我们会为你处理。",
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "转人工",
      node_type: "handoff",
      label: "转人工",
      config: {
        note: "客户在常见问题机器人中请求转人工。",
      } as HandoffNodeConfig,
    },
    {
      node_key: "end",
      node_type: "end",
      label: "结束",
      config: {},
    },
  ],
};

// ============================================================
// 3. Lead capture — collect_input chain, ends in a handoff
// ============================================================
const LEAD_CAPTURE: FlowTemplate = {
  slug: "lead_capture",
  name: "线索收集",
  description:
    "向首次咨询的客户问好，收集姓名、邮箱和公司信息，然后将答案附在备注中转交给销售。",
  icon: "UserPlus",
  trigger_type: "first_inbound_message",
  trigger_config: {},
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      label: "开始",
      config: { next_node_key: "欢迎语" },
    },
    {
      node_key: "欢迎语",
      node_type: "send_message",
      label: "欢迎语",
      config: {
        text: "欢迎！👋 我会问几个简单的问题，以便帮你找到合适的对接人。",
        next_node_key: "询问姓名",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "询问姓名",
      node_type: "collect_input",
      label: "询问姓名",
      config: {
        prompt_text: "请问你的姓名是？",
        var_key: "name",
        next_node_key: "询问邮箱",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "询问邮箱",
      node_type: "collect_input",
      label: "询问邮箱",
      config: {
        prompt_text: "谢谢 {{vars.name}}！请问你的工作邮箱是？",
        var_key: "email",
        next_node_key: "询问公司",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "询问公司",
      node_type: "collect_input",
      label: "询问公司",
      config: {
        prompt_text: "快完成了——请问你的公司名称是？",
        var_key: "company",
        next_node_key: "转交销售",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "转交销售",
      node_type: "handoff",
      label: "转交销售",
      config: {
        note: "新线索——姓名={{vars.name}}，邮箱={{vars.email}}，公司={{vars.company}}。",
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// Registry
// ============================================================

const TEMPLATES: Record<string, FlowTemplate> = {
  welcome_menu: WELCOME_MENU,
  faq_bot: FAQ_BOT,
  lead_capture: LEAD_CAPTURE,
};

export function getFlowTemplate(slug: string): FlowTemplate | null {
  return TEMPLATES[slug] ?? null;
}

export function listFlowTemplates(): FlowTemplate[] {
  return Object.values(TEMPLATES);
}
