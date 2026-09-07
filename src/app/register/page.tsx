import Link from "next/link";
import { RegisterForm } from "@/components/register-form";

export default function RegisterPage() {
  return (
    <div className="flex flex-col gap-4">
      <RegisterForm />
      <p className="text-center text-sm text-zinc-500">
        Уже есть аккаунт?{" "}
        <Link href="/login" className="text-peach hover:underline">
          Войти
        </Link>
      </p>
    </div>
  );
}
