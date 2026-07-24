"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import { DocumentImage, ImageAdjustments, ImageCorners, ImageStatus } from "@/types/image";
import { revokeDocumentImageUrls } from "@/lib/image";

interface ImageStoreState {
  images: DocumentImage[];
}

interface UpdateProcessingResultPayload {
  id: string;
  status: ImageStatus;
  correctedUrl?: string;
  corners?: ImageCorners;
  imageAdjustments?: ImageAdjustments;
  statusMessage?: string;
}

type ImageStoreAction =
  | { type: "ADD_IMAGES"; images: DocumentImage[] }
  | { type: "REMOVE_IMAGE"; id: string }
  | { type: "REORDER"; orderedIds: string[] }
  | { type: "CLEAR" }
  | { type: "UPDATE_PROCESSING_RESULT"; payload: UpdateProcessingResultPayload };

function imageStoreReducer(
  state: ImageStoreState,
  action: ImageStoreAction
): ImageStoreState {
  switch (action.type) {
    case "ADD_IMAGES":
      return { images: [...state.images, ...action.images] };

    case "REMOVE_IMAGE": {
      const target = state.images.find((img) => img.id === action.id);
      if (target) revokeDocumentImageUrls(target);
      return { images: state.images.filter((img) => img.id !== action.id) };
    }

    case "REORDER": {
      const byId = new Map(state.images.map((img) => [img.id, img]));
      const reordered = action.orderedIds
        .map((id) => byId.get(id))
        .filter((img): img is DocumentImage => img !== undefined);
      return { images: reordered };
    }

    case "CLEAR": {
      state.images.forEach(revokeDocumentImageUrls);
      return { images: [] };
    }

    case "UPDATE_PROCESSING_RESULT": {
      const { id, status, correctedUrl, corners, imageAdjustments, statusMessage } = action.payload;
      return {
        images: state.images.map((img) => {
          if (img.id !== id) return img;

          // 若這張圖片先前已經有校正結果、這次又產生新的，釋放舊的 URL 避免記憶體洩漏
          if (correctedUrl && img.correctedUrl && img.correctedUrl !== correctedUrl) {
            URL.revokeObjectURL(img.correctedUrl);
          }

          return {
            ...img,
            status,
            correctedUrl: correctedUrl ?? img.correctedUrl,
            corners: corners ?? img.corners,
            imageAdjustments: imageAdjustments ?? img.imageAdjustments,
            statusMessage,
          };
        }),
      };
    }

    default:
      return state;
  }
}

interface ImageStoreContextValue {
  images: DocumentImage[];
  addImages: (images: DocumentImage[]) => void;
  removeImage: (id: string) => void;
  reorderImages: (orderedIds: string[]) => void;
  clearImages: () => void;
  updateProcessingResult: (payload: UpdateProcessingResultPayload) => void;
}

const ImageStoreContext = createContext<ImageStoreContextValue | null>(null);

export function ImageStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(imageStoreReducer, { images: [] });

  const addImages = useCallback((images: DocumentImage[]) => {
    dispatch({ type: "ADD_IMAGES", images });
  }, []);

  const removeImage = useCallback((id: string) => {
    dispatch({ type: "REMOVE_IMAGE", id });
  }, []);

  const reorderImages = useCallback((orderedIds: string[]) => {
    dispatch({ type: "REORDER", orderedIds });
  }, []);

  const clearImages = useCallback(() => {
    dispatch({ type: "CLEAR" });
  }, []);

  const updateProcessingResult = useCallback(
    (payload: UpdateProcessingResultPayload) => {
      dispatch({ type: "UPDATE_PROCESSING_RESULT", payload });
    },
    []
  );

  const value = useMemo(
    () => ({
      images: state.images,
      addImages,
      removeImage,
      reorderImages,
      clearImages,
      updateProcessingResult,
    }),
    [
      state.images,
      addImages,
      removeImage,
      reorderImages,
      clearImages,
      updateProcessingResult,
    ]
  );

  return (
    <ImageStoreContext.Provider value={value}>
      {children}
    </ImageStoreContext.Provider>
  );
}

export function useImageStore(): ImageStoreContextValue {
  const context = useContext(ImageStoreContext);
  if (!context) {
    throw new Error("useImageStore 必須在 ImageStoreProvider 內使用");
  }
  return context;
}
