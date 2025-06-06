import { useState } from 'react'
import DebugInfo from "./components/DebugInfo";
import HandTracking from './components/HandTracking'
import CameraSelector from './components/CameraSelector'
import './App.css'

function App() {
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);

  const handleCameraSelect = (deviceId: string) => {
    setSelectedCameraId(deviceId);
  };

  if (!selectedCameraId) {
    return (
      <>
        <CameraSelector onCameraSelect={handleCameraSelect} />
        <DebugInfo />
      </>
    );
  }

  return (
    <>
      <HandTracking cameraId={selectedCameraId} />
      <DebugInfo />
    </>
  );
}

export default App