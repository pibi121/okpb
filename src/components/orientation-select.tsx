"use client";

import {
  socialOrientationOptionLabel,
  orientationOptionLabel,
  VIDEO_ORIENTATION_IDS,
  type SocialOrientationId,
  type VideoOrientationId,
} from "@/lib/video-orientation";

type BaseProps = {
  className?: string;
  disabled?: boolean;
  id?: string;
};

type VideoProps = BaseProps & {
  mode?: "video";
  value: VideoOrientationId;
  onChange: (v: VideoOrientationId) => void;
};

type SocialProps = BaseProps & {
  mode: "social";
  value: SocialOrientationId;
  onChange: (v: SocialOrientationId) => void;
  includeMatch?: boolean;
};

export function OrientationSelect(props: VideoProps | SocialProps) {
  const cls =
    props.className ||
    "w-full rounded-md border border-white/10 bg-[#161618] px-3 py-2 text-sm";

  if (props.mode === "social") {
    const matchOpts: SocialOrientationId[] = props.includeMatch
      ? ["match_photo", "match_video"]
      : [];
    return (
      <select
        id={props.id}
        disabled={props.disabled}
        className={cls}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value as SocialOrientationId)}
      >
        {matchOpts.map((id) => (
          <option key={id} value={id}>
            {socialOrientationOptionLabel(id)}
          </option>
        ))}
        {VIDEO_ORIENTATION_IDS.map((id) => (
          <option key={id} value={id}>
            {orientationOptionLabel(id)}
          </option>
        ))}
      </select>
    );
  }

  return (
    <select
      id={props.id}
      disabled={props.disabled}
      className={cls}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value as VideoOrientationId)}
    >
      {VIDEO_ORIENTATION_IDS.map((id) => (
        <option key={id} value={id}>
          {orientationOptionLabel(id)}
        </option>
      ))}
    </select>
  );
}
