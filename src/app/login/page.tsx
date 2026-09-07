import Link from "next/link";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-4">
      <LoginForm />
      <p className="text-center text-sm text-zinc-500">
        Нет аккаунта?{" "}
        <Link href="/register" className="text-peach hover:underline">
          Регистрация
        </Link>
      </p>
    </div>
  );
}
