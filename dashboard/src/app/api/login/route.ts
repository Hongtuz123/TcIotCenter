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

    const validUsers = (process.env.SYS_VALID_USERS || "tim,wenhe,frank,jason,oscar,levi,ren,allison").split(",");
    const systemPassword = process.env.SYS_PASSWORD || "pstcom";

    // 帳號驗證
    if (validUsers.includes(username) && password === systemPassword) {
      const role = username === "tim" ? "admin" : "user";
      const cookieStore = await cookies();
      cookieStore.set("auth_session", `session_verified_${username}`, {
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

      return NextResponse.json({ success: true, role, username });
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
