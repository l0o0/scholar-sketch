export function pickZoteroItems(
  win: Window,
  opts: { onlyRegularItems?: boolean } = {},
): number[] | null {
  const Services = ztoolkit.getGlobal("Services") as {
    ww: {
      openWindow: (
        parent: Window | null,
        url: string,
        name: string,
        features: string,
        args: unknown,
      ) => void;
    };
  };
  const io: {
    dataOut?: number[] | null;
    singleSelection: boolean;
    onlyRegularItems?: boolean;
    multiSelect: boolean;
  } = {
    dataOut: null,
    singleSelection: false,
    onlyRegularItems: opts.onlyRegularItems ?? false,
    multiSelect: true,
  };
  Services.ww.openWindow(
    null,
    "chrome://zotero/content/selectItemsDialog.xhtml",
    "",
    "chrome,modal,centerscreen,resizable=yes",
    io,
  );
  return io.dataOut?.length ? io.dataOut : null;
}
