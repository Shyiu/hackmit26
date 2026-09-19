// Spoken, rounded times for answers and the dashboard. Safe on the client and the server.

const NUMBER_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function spokenMinutes(minutes: number): string {
  const rounded = Math.max(5, Math.round(minutes / 5) * 5);
  const words: Record<number, string> = {
    5: "five",
    10: "ten",
    15: "fifteen",
    20: "twenty",
    25: "twenty-five",
    30: "thirty",
    35: "thirty-five",
    40: "forty",
  };
  return words[rounded] ?? String(rounded);
}

/** "a few minutes ago", "about twenty minutes ago". Nobody wants to hear "47 minutes ago". */
export function relativeTime(then: Date, now: Date): string {
  const minutes = (now.getTime() - then.getTime()) / 60_000;
  if (minutes < 1) return "just now";
  if (minutes < 5) return "a few minutes ago";
  if (minutes < 43) return `about ${spokenMinutes(minutes)} minutes ago`;
  if (minutes < 90) return "about an hour ago";
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `about ${NUMBER_WORDS[hours] ?? hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  return days <= 7 ? `about ${NUMBER_WORDS[days] ?? days} days ago` : "more than a week ago";
}
