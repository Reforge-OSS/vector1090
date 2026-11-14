"use client";
import { useEffect, useState } from "react";

export function useReceiverConfig() {
  const [config, setConfig] = useState({
    allowClientLocalUrl: false,
    localUrlConfigured: false,
    localReceiverConfigured: false,
  });
  useEffect(() => {
    let active = true;
    void fetch("/api/config", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("config_failed");
        return response.json();
      })
      .then((data) => {
        if (active)
          setConfig({
            allowClientLocalUrl: data.allowClientLocalUrl === true,
            localUrlConfigured: data.localUrlConfigured === true,
            localReceiverConfigured: data.localReceiverConfigured === true,
          });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return config;
}
