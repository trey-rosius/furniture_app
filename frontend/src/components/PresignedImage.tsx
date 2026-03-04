import { useState, useEffect } from "react";
import { generateClient } from "aws-amplify/api";
import { Loader2 } from "lucide-react";

const client = generateClient();

interface PresignedImageProps {
  uri: string;
  alt: string;
  className?: string;
}

export default function PresignedImage({
  uri,
  alt,
  className,
}: PresignedImageProps) {
  const [url, setUrl] = useState<string>("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uri) {
      setLoading(false);
      return;
    }

    // If it's already a full http URL, just use it
    if (uri.startsWith("http")) {
      setUrl(uri);
      setLoading(false);
      return;
    }

    // Otherwise, assume it's a key or s3:// URI and get a presigned URL
    const fetchUrl = async () => {
      setLoading(true);
      try {
        const res = (await client.graphql({
          query: `mutation GetPresignedUrl($uri: String!) {
            getPresignedUrl(uri: $uri)
          }`,
          variables: { uri },
        })) as any;

        setUrl(res.data.getPresignedUrl);
        setLoading(false);
      } catch (err) {
        console.error("Error fetching presigned url", err);
        setError(true);
        setLoading(false);
      }
    };

    fetchUrl();
  }, [uri]);

  if (loading) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-50 ${className}`}
      >
        <Loader2 className="w-5 h-5 animate-spin text-[#e7b923]/40" />
      </div>
    );
  }

  if (error || !url) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 text-gray-400 text-[10px] text-center p-2 ${className}`}
      >
        Image Unavailable
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      onError={() => setError(true)}
      referrerPolicy="no-referrer"
    />
  );
}
