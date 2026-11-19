export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

/** Hands a file to the browser as a download (the blob is released a second later). */
export function downloadBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Insecure origins and older browsers: a hidden field and the copy command.
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  }
}

/**
 * The share sheet of the phone (`navigator.share`), or the link copied when there is none. A
 * shopper who closes the sheet is "cancelled", not an error.
 */
export async function shareOrCopy(data: {
  title: string;
  text: string;
  url: string;
}): Promise<ShareResult> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share(data);
      return "shared";
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // Fall through to the copy: the sheet refused for another reason.
    }
  }
  return (await copyText(data.url)) ? "copied" : "failed";
}
