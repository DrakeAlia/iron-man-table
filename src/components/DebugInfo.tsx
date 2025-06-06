import React, { useState, useEffect } from "react";

const DebugInfo: React.FC = () => {
  const [debugInfo, setDebugInfo] = useState<{
    protocol: string;
    userAgent: string;
    mediaDevicesSupported: boolean;
    httpsStatus: boolean;
    mediaConstraints: MediaTrackSupportedConstraints | null;
    permissions: { camera: PermissionState } | null;
    mediaPipeTest: string;
  }>({
    protocol: "",
    userAgent: "",
    mediaDevicesSupported: false,
    httpsStatus: false,
    mediaConstraints: null,
    permissions: null,
    mediaPipeTest: "Testing...",
  });

  useEffect(() => {
    const checkEnvironment = async () => {
      const info = {
        protocol: window.location.protocol,
        userAgent: navigator.userAgent,
        mediaDevicesSupported: !!(
          navigator.mediaDevices && navigator.mediaDevices.getUserMedia
        ),
        httpsStatus:
          window.location.protocol === "https:" ||
          window.location.hostname === "localhost",
        mediaConstraints: null as MediaTrackSupportedConstraints | null,
        permissions: null as { camera: PermissionState } | null,
        mediaPipeTest: "Testing...",
      };

      // Check media constraints support
      if (navigator.mediaDevices) {
        try {
          const constraints =
            await navigator.mediaDevices.getSupportedConstraints();
          info.mediaConstraints = constraints;
        } catch (err) {
          console.error("Error getting media constraints:", err);
        }

        // Check permissions
        try {
          if ("permissions" in navigator) {
            const cameraPermission = await navigator.permissions.query({
              name: "camera" as PermissionName,
            });
            info.permissions = {
              camera: cameraPermission.state,
            };
          }
        } catch (err) {
          console.error("Error checking permissions:", err);
        }
      }

      // Test MediaPipe CDN access
      try {
        const response = await fetch(
          "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js",
          { method: "HEAD" }
        );
        info.mediaPipeTest = response.ok ? "CDN Accessible" : "CDN Failed";
      } catch (err) {
        info.mediaPipeTest = "CDN Error";
      }

      setDebugInfo(info);
    };

    checkEnvironment();
  }, []);

  // Show debug info in development or when there are issues
  const shouldShow =
    process.env.NODE_ENV === "development" ||
    !debugInfo.httpsStatus ||
    !debugInfo.mediaDevicesSupported ||
    debugInfo.permissions?.camera !== "granted";

  if (!shouldShow) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 bg-black bg-opacity-90 text-white p-4 rounded-lg text-xs max-w-sm z-50 border border-cyan-500">
      <h3 className="text-cyan-400 font-bold mb-2">🔧 Debug Info</h3>
      <div className="space-y-1">
        <div>
          Protocol:{" "}
          <span
            className={
              debugInfo.protocol === "https:"
                ? "text-green-400"
                : "text-red-400"
            }
          >
            {debugInfo.protocol}
          </span>
        </div>
        <div>
          HTTPS:{" "}
          <span
            className={
              debugInfo.httpsStatus ? "text-green-400" : "text-red-400"
            }
          >
            {debugInfo.httpsStatus ? "✅ Yes" : "❌ No"}
          </span>
        </div>
        <div>
          MediaDevices:{" "}
          <span
            className={
              debugInfo.mediaDevicesSupported
                ? "text-green-400"
                : "text-red-400"
            }
          >
            {debugInfo.mediaDevicesSupported
              ? "✅ Supported"
              : "❌ Not Supported"}
          </span>
        </div>
        <div>
          MediaPipe CDN:{" "}
          <span
            className={
              debugInfo.mediaPipeTest === "CDN Accessible"
                ? "text-green-400"
                : "text-red-400"
            }
          >
            {debugInfo.mediaPipeTest}
          </span>
        </div>
        {debugInfo.permissions && (
          <div>
            Camera Permission:{" "}
            <span
              className={
                debugInfo.permissions.camera === "granted"
                  ? "text-green-400"
                  : debugInfo.permissions.camera === "prompt"
                  ? "text-yellow-400"
                  : "text-red-400"
              }
            >
              {debugInfo.permissions.camera === "granted"
                ? "✅"
                : debugInfo.permissions.camera === "prompt"
                ? "⚠️"
                : "❌"}{" "}
              {debugInfo.permissions.camera}
            </span>
          </div>
        )}
        <div className="mt-2 text-gray-400 text-xs">
          {window.location.hostname}
        </div>
      </div>

      {(!debugInfo.httpsStatus || !debugInfo.mediaDevicesSupported) && (
        <div className="mt-3 p-2 bg-red-900 bg-opacity-50 rounded text-red-200 text-xs">
          ⚠️ Camera requires HTTPS and modern browser
        </div>
      )}
    </div>
  );
};

export default DebugInfo;
