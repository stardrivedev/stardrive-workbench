"use client";

import { useEffect, useState } from "react";
import { getSetupQrAction } from "../actions";

export default function SetupClient() {
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    getSetupQrAction().then((res) => {
      if ("error" in res) setError(res.error);
      else {
        setQr(res.qr);
        setSecret(res.secret);
      }
    });
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!qr) return <p className="text-sm text-muted">Generating QR code…</p>;

  return (
    <div className="space-y-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="TOTP enrollment QR code" className="rounded-md border border-heading/10" />
      <div className="text-sm">
        <p className="font-medium text-heading">Manual entry secret</p>
        <code className="mt-1 block break-all rounded-md bg-heading/5 px-3 py-2 text-xs">{secret}</code>
      </div>
    </div>
  );
}
