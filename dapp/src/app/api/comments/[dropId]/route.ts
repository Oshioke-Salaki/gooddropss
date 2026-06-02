import { NextRequest, NextResponse } from "next/server";
import { getRedis, keys } from "@/lib/redis";

export const runtime = "nodejs";

export interface Comment {
  id:        string;
  dropId:    string;
  author:    string;
  text:      string;
  timestamp: number;
}

// GET /api/comments/[dropId]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dropId: string }> }
) {
  const { dropId } = await params;
  const redis = getRedis();
  if (!redis) return NextResponse.json({ comments: [] });

  try {
    const raw = await redis.lrange<string>(keys.comments(dropId), 0, -1);
    const comments: Comment[] = raw
      .map((r) => {
        try { return typeof r === "string" ? JSON.parse(r) : r; } catch { return null; }
      })
      .filter(Boolean)
      .reverse(); // newest first
    return NextResponse.json({ comments });
  } catch (e) {
    console.error("[comments/get]", e);
    return NextResponse.json({ comments: [] });
  }
}

// POST /api/comments/[dropId]
// Body: { author: string, text: string }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dropId: string }> }
) {
  const { dropId } = await params;

  try {
    const { author, text } = await req.json();
    if (!author || !text?.trim()) {
      return NextResponse.json({ error: "Missing author or text" }, { status: 400 });
    }
    if (text.trim().length > 280) {
      return NextResponse.json({ error: "Comment too long (max 280 chars)" }, { status: 400 });
    }

    const redis = getRedis();
    if (!redis) return NextResponse.json({ error: "Comments unavailable" }, { status: 503 });

    // Cap at 50 comments per drop
    const count = await redis.llen(keys.comments(dropId));
    if (count >= 50) {
      return NextResponse.json({ error: "Comment limit reached" }, { status: 429 });
    }

    const comment: Comment = {
      id:        `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      dropId,
      author:    author.toLowerCase(),
      text:      text.trim(),
      timestamp: Math.floor(Date.now() / 1000),
    };

    await redis.rpush(keys.comments(dropId), JSON.stringify(comment));
    return NextResponse.json({ comment });
  } catch (e) {
    console.error("[comments/post]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
