import { useState } from "react";

export function ImageWithFallback(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  const [failed, setFailed] = useState(false);
  return failed ? <div>image</div> : <img {...props} onError={() => setFailed(true)} />;
}
