import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get("auth_session")?.value;
    if (!session || !session.startsWith("session_verified_")) {
      return NextResponse.json({ authenticated: false, role: 'user', username: '' });
    }
    const username = session.replace("session_verified_", "");
    const role = username === "tim" ? "admin" : "user";
    return NextResponse.json({ authenticated: true, role, username });
  } catch {
    return NextResponse.json({ authenticated: false, role: 'user', username: '' });
  }
}

export async function POST(request: Request) {
  try {
    const { username, password } = await request.json();

    const rawUsername = (username || "").trim().toLowerCase();
    const cleanPassword = (password || "").trim();

    const defaultUsers = ["tim", "wenhe", "frank", "jason", "oscar", "levi", "ren", "allison", "chanel", "sage", "stace", "albert", "test1", "test2", "test3"];
    const envUsers = (process.env.SYS_VALID_USERS || "").split(",").map((u) => u.trim().toLowerCase()).filter(Boolean);
    const validUsers = Array.from(new Set([...defaultUsers, ...envUsers]));
    const systemPassword = process.env.SYS_PASSWORD || "pstcom";

    // 帳號驗證
    if (validUsers.includes(rawUsername) && cleanPassword === systemPassword) {
      const role = rawUsername === "tim" ? "admin" : "user";
      const cookieStore = await cookies();
      cookieStore.set("auth_session", `session_verified_${rawUsername}`, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
      });
      cookieStore.set("user_role", role, {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
      });

      return NextResponse.json({ success: true, role, username: rawUsername });
    }

    return NextResponse.json(
      { error: "帳號或密碼錯誤" },
      { status: 401 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "無效的請求" },
      { status: 400 }
    );
  }
}
