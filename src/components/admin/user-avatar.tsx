"use client";

import Image from "next/image";
import { useState } from "react";
import { withBasePath } from "@/lib/base-path";

type UserAvatarProps = {
  userId: string;
  name: string | null;
  image: string | null;
  avatarUpdatedAt?: string | null;
};

function AvatarImage({ sources, name }: { sources: string[]; name: string | null }) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const displayName = name?.trim() || "使用者";
  const label = `${displayName}的頭貼`;
  const className = "size-10 shrink-0 rounded-full object-cover";

  return sources[sourceIndex] ? (
    <Image
      unoptimized
      width={40}
      height={40}
      src={sources[sourceIndex]}
      alt={label}
      referrerPolicy="no-referrer"
      className={className}
      onError={() => setSourceIndex((current) => current + 1)}
    />
  ) : (
    <span aria-label={label} className={`${className} flex items-center justify-center bg-clay-soft font-semibold text-clay-strong`}>
      {Array.from(displayName)[0]}
    </span>
  );
}

export function UserAvatar({ userId, name, image, avatarUpdatedAt }: UserAvatarProps) {
  const sources = [
    avatarUpdatedAt ? withBasePath(`/api/admin/users/${encodeURIComponent(userId)}/avatar?v=${encodeURIComponent(avatarUpdatedAt)}`) : null,
    image,
  ].filter((source): source is string => source !== null);
  return <AvatarImage key={JSON.stringify([sources, name])} sources={sources} name={name} />;
}
