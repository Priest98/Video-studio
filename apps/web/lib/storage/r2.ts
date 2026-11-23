import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function client() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !process.env.R2_BUCKET) throw new Error("R2 is not configured");
  return new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
}

/** Keys are always prefixed by workspace id, so a signed URL can only ever touch one tenant's objects. */
export const sourceKey = (workspaceId: string, projectId: string) => `${workspaceId}/${projectId}/source`;
export const clipKey = (workspaceId: string, projectId: string, clipId: string) => `${workspaceId}/${projectId}/clips/${clipId}.mp4`;

export const signedPut = (key: string, contentType: string, seconds = 900) =>
  getSignedUrl(client(), new PutObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key, ContentType: contentType }), { expiresIn: seconds });

export const signedGet = (key: string, seconds = 900) =>
  getSignedUrl(client(), new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }), { expiresIn: seconds });
