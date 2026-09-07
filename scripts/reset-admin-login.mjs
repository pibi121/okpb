import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const EMAIL = process.env.ADMIN_EMAIL || "admin@peachbitch.local";
const PASSWORD = process.env.ADMIN_PASSWORD || "";
const NAME = process.env.ADMIN_NAME || "Admin";
if (!PASSWORD) {
  console.error("Set ADMIN_PASSWORD");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);

  // Prefer the account that already owns the most gallery work.
  const ranked = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      source: true,
      _count: { select: { galleryItems: true, characters: true } },
    },
  });
  ranked.sort(
    (a, b) =>
      b._count.galleryItems + b._count.characters - (a._count.galleryItems + a._count.characters),
  );

  console.log(
    "users:",
    ranked.map((u) => ({
      email: u.email,
      gallery: u._count.galleryItems,
      chars: u._count.characters,
      source: u.source,
    })),
  );

  const owner =
    ranked.find((u) => !u.email.includes("@peachbitch.internal") && !u.email.startsWith("tg_")) ||
    ranked[0];

  if (!owner) {
    const created = await prisma.user.create({
      data: {
        email: EMAIL,
        passwordHash: hash,
        name: NAME,
        adminRole: "owner",
        ageConfirmed: true,
        credits: 100000,
        balancePeaches: 0,
        source: "web",
      },
    });
    console.log("created_new", { id: created.id, email: EMAIL });
  } else {
    // Keep the same user id / gallery / characters; just set login credentials.
    const updated = await prisma.user.update({
      where: { id: owner.id },
      data: {
        email: EMAIL,
        passwordHash: hash,
        name: owner.name || NAME,
        ageConfirmed: true,
        adminRole: "owner",
      },
    });
    console.log("updated_owner", {
      id: updated.id,
      oldEmail: owner.email,
      newEmail: EMAIL,
      gallery: owner._count.galleryItems,
      characters: owner._count.characters,
    });
  }

  console.log("LOGIN_EMAIL=", EMAIL);
  console.log("LOGIN_PASSWORD=", PASSWORD);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
