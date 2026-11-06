"use client";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { useEffect, useState } from "react";
import { Id } from "../convex/_generated/dataModel";

type User = { _id: Id<"users">; name: string; role: string; trustedLender: boolean };

export default function Home() {
  const users = (useQuery(api.users.list) ?? []) as User[];
  const seed = useMutation(api.users.seedDemo);
  const [me, setMe] = useState<Id<"users"> | null>(null);
  const [cat, setCat] = useState("");
  const [tab, setTab] = useState<"browse" | "mine" | "borrow" | "incoming">("browse");

  useEffect(() => { if (!users.length) seed(); }, [users.length]);

  const tools = useQuery(api.tools.list, { category: cat || undefined }) ?? [];
  const cats = useQuery(api.tools.categories) ?? [];
  const myTools = useQuery(api.tools.myListings, me ? { userId: me } : "skip") ?? [];
  const borrow = useQuery(api.loans.myRequests, me ? { userId: me } : "skip") ?? [];
  const incoming = useQuery(api.loans.incomingRequests, me ? { userId: me } : "skip") ?? [];
  const activity = useQuery(api.loans.activity,
    me && borrow[0] ? { userId: me, loanId: borrow[0]._id } : "skip") ?? [];

  const create = useMutation(api.tools.create);
  const remove = useMutation(api.tools.remove);
  const request = useMutation(api.loans.request);
  const decide = useMutation(api.loans.decide);
  const back = useMutation(api.loans.markReturned);
  const trust = useMutation(api.loans.markTrustedLender);

  const meDoc = users.find((u) => u._id === me);
  const userName = (id: string) => users.find((u) => u._id === id)?.name ?? id;

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 860, margin: "2rem auto" }}>
      <h1>Tool Lending</h1>
      <p>
        Acting as:{" "}
        <select value={me ?? ""} onChange={(e) => setMe(e.target.value as Id<"users">)}>
          <option value="">choose user…</option>
          {users.map((u) => (
            <option key={u._id} value={u._id}>
              {u.name} ({u.role}{u.trustedLender ? ", trusted" : ""})
            </option>
          ))}
        </select>
      </p>
      <nav style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["browse", "mine", "borrow", "incoming"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} disabled={!me}
            style={{ fontWeight: tab === t ? 700 : 400 }}>{t}</button>
        ))}
      </nav>

      {tab === "browse" && me && (
        <>
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">all categories</option>
            {cats.map((c) => <option key={c}>{c}</option>)}
          </select>
          <ul>
            {tools.map((t) => (
              <li key={t._id} style={{ margin: "8px 0" }}>
                <b>{t.title}</b> — {t.category} — by {userName(t.ownerId)} —{" "}
                {t.available ? "available" : "out"}
                {t.available && t.ownerId !== me && (
                  <button style={{ marginLeft: 8 }} onClick={() => {
                    const s = prompt("start (yyyy-mm-dd)", "2026-11-10");
                    const e = prompt("end (yyyy-mm-dd)", "2026-11-17");
                    if (s && e) request({ userId: me, toolId: t._id, startDate: s, endDate: e });
                  }}>borrow</button>
                )}
                {meDoc?.role === "admin" && (
                  <button style={{ marginLeft: 8 }}
                    onClick={() => remove({ userId: me, toolId: t._id })}>remove</button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === "mine" && me && (
        <>
          <button onClick={() => {
            const title = prompt("title"); const category = prompt("category");
            if (title && category) create({ userId: me, title, description: "", category });
          }}>+ new listing</button>
          <ul>
            {myTools.map((t) => (
              <li key={t._id}>
                {t.title} ({t.category}) {t.available ? "" : "— unavailable"}
                <button style={{ marginLeft: 8 }}
                  onClick={() => remove({ userId: me, toolId: t._id })}>delete</button>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === "borrow" && me && (
        <ul>
          {borrow.map((l) => (
            <li key={l._id}>
              {l.startDate}..{l.endDate} — {l.status} — lender {userName(l.lenderId)}
              {l.remindersSent > 0 && <em> (reminded {l.remindersSent}x)</em>}
              {activity.map((a) => a.loanId === l._id && (
                <small key={a._id} style={{ display: "block", color: "#666" }}>
                  {a.type} · {a.createdAt}
                </small>
              ))}
            </li>
          ))}
        </ul>
      )}

      {tab === "incoming" && me && (
        <ul>
          {incoming.map((l) => (
            <li key={l._id}>
              {userName(l.borrowerId)} wants {l.startDate}..{l.endDate} — {l.status}
              {l.status === "requested" && (
                <>
                  <button style={{ marginLeft: 8 }}
                    onClick={() => decide({ userId: me, loanId: l._id, approve: true })}>approve</button>
                  <button onClick={() => decide({ userId: me, loanId: l._id, approve: false })}>decline</button>
                </>
              )}
              {l.status === "approved" && (
                <button style={{ marginLeft: 8 }}
                  onClick={() => back({ userId: me, loanId: l._id })}>mark returned</button>
              )}
              {meDoc?.role === "admin" && (
                <button style={{ marginLeft: 8 }}
                  onClick={() => trust({ userId: me, lenderId: l.lenderId, trusted: true })}>
                  trust lender</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
