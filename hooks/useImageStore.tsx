"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import { DocumentImage } from "@/types/image";
import { revokeDocumentImageUrls } from "@/lib/image";

interface ImageStoreState {
  images: DocumentImage[];
}

type ImageStoreAction =
  | { type: "ADD_IMAGES"; images: DocumentImage[] }
  | { type: "REMOVE_IMAGE"; id: string }
  | { type: "REORDER"; orderedIds: string[] }
  | { type: "CLEAR" };

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

  const value = useMemo(
    () => ({
      images: state.images,
      addImages,
      removeImage,
      reorderImages,
      clearImages,
    }),
    [state.images, addImages, removeImage, reorderImages, clearImages]
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
