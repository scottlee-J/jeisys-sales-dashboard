"use client";

import { useState } from "react";

type Message = { role: "user" | "assistant"; content: string };

export type SearchFilters = {
  teams: string[];
  countries: string[];
  clients: string[];
  equipments: string[];
  items: string[];
  periodUnit: "year" | "half" | "quarter" | "month" | null;
  measure: "amount" | "quantity" | null;
};

const FIRST_MESSAGE: Message = {
  role: "assistant",
  content:
    "실적을 입력하거나 보고 싶은 조건을 말해 주세요.\n입력 예) AMJAD 2026년 8월 Density 실적 250000\n조회 예) APAC 1실 소모품1 분기별로 보여줘",
};

export default function Chatbot({
  onSaved,
  onSearch,
}: {
  onSaved: () => void;
  onSearch: (filters: SearchFilters) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([FIRST_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // 평소에는 입력만 하고, 이전 기록을 보고 싶을 때 펼친다.
  const [expanded, setExpanded] = useState(false);

  const lastReply = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 첫 안내 메시지는 대화 맥락에서 제외하고 보낸다.
        body: JSON.stringify({ messages: next.slice(1) }),
      });
      const data = await res.json();
      setMessages([...next, { role: "assistant", content: data.reply }]);
      // 저장이 끝났으면 대시보드를 다시 불러오고, 조회면 화면 조건을 바꾼다.
      if (data.saved) onSaved();
      if (data.searchFilters) onSearch(data.searchFilters);
    } catch {
      setMessages([
        ...next,
        {
          role: "assistant",
          content: "오류가 발생했습니다. 다시 시도해 주세요.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-black/10 dark:border-white/15">
      <div className="flex items-center gap-2 p-3">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") send();
          }}
          placeholder="입력: AMJAD 2026년 8월 Density 실적 250000 / 조회: EU팀 분기별로 보여줘"
          className="flex-1 rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-white/20"
        />
        <button
          onClick={send}
          disabled={loading}
          className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          전송
        </button>
        <button
          onClick={() => setExpanded(!expanded)}
          className="rounded-md border border-black/15 px-3 py-2 text-sm text-black/70 dark:border-white/20 dark:text-white/70"
        >
          {expanded ? "접기" : "기록 보기"}
        </button>
      </div>

      {/* 접혀 있을 때는 마지막 답변 한 줄만 보여 준다. */}
      {!expanded && (
        <div className="truncate border-t border-black/10 px-4 py-2 text-sm text-black/60 dark:border-white/15 dark:text-white/60">
          {loading
            ? "내용을 확인하고 있습니다..."
            : lastReply?.content.split("\n")[0]}
        </div>
      )}

      {expanded && (
        <div className="max-h-80 space-y-3 overflow-y-auto border-t border-black/10 p-4 dark:border-white/15">
          {messages.map((message, index) => (
            <div
              key={index}
              className={message.role === "user" ? "text-right" : "text-left"}
            >
              <span
                className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                  message.role === "user"
                    ? "bg-indigo-500 text-white"
                    : "bg-black/5 dark:bg-white/10"
                }`}
              >
                {message.content}
              </span>
            </div>
          ))}
          {loading && (
            <div className="text-sm text-black/50 dark:text-white/50">
              내용을 확인하고 있습니다...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
