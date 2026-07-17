import { ImageStoreProvider } from "@/hooks/useImageStore";
import DocumentAssistantApp from "@/components/DocumentAssistantApp";

export default function Home() {
  return (
    <ImageStoreProvider>
      <DocumentAssistantApp />
    </ImageStoreProvider>
  );
}
