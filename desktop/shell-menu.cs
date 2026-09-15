using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace PaneShell {
  [ComImport, Guid("000214E6-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellFolder {
    void ParseDisplayName(); void EnumObjects(); void BindToObject(); void BindToStorage();
    void CompareIDs(); void CreateViewObject(); void GetAttributesOf();
    [PreserveSig] int GetUIObjectOf(IntPtr hwnd, uint count, [MarshalAs(UnmanagedType.LPArray, SizeParamIndex=1)] IntPtr[] children, ref Guid iid, IntPtr reserved, out IntPtr result);
    void GetDisplayNameOf(); void SetNameOf();
  }
  [ComImport, Guid("000214E4-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IContextMenu {
    [PreserveSig] int QueryContextMenu(IntPtr menu, uint index, uint first, uint last, uint flags);
    [PreserveSig] int InvokeCommand(ref Command info);
    [PreserveSig] int GetCommandString(UIntPtr id, uint flags, IntPtr reserved, IntPtr name, uint max);
  }
  [ComImport, Guid("000214F4-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IContextMenu2 {
    [PreserveSig] int QueryContextMenu(IntPtr menu, uint index, uint first, uint last, uint flags);
    [PreserveSig] int InvokeCommand(ref Command info);
    [PreserveSig] int GetCommandString(UIntPtr id, uint flags, IntPtr reserved, IntPtr name, uint max);
    [PreserveSig] int HandleMenuMsg(uint msg, IntPtr wp, IntPtr lp);
  }
  [ComImport, Guid("BCFCE0A0-EC17-11D0-8D10-00A0C90F2719"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IContextMenu3 {
    [PreserveSig] int QueryContextMenu(IntPtr menu, uint index, uint first, uint last, uint flags);
    [PreserveSig] int InvokeCommand(ref Command info);
    [PreserveSig] int GetCommandString(UIntPtr id, uint flags, IntPtr reserved, IntPtr name, uint max);
    [PreserveSig] int HandleMenuMsg(uint msg, IntPtr wp, IntPtr lp);
    [PreserveSig] int HandleMenuMsg2(uint msg, IntPtr wp, IntPtr lp, out IntPtr result);
  }
  [StructLayout(LayoutKind.Sequential)]
  struct Command { public int size; public uint mask; public IntPtr hwnd, verb, parameters, directory; public int show; public uint hotkey; public IntPtr icon; }
  public class MenuHost : Form {
    IContextMenu context;
    [DllImport("shell32.dll", CharSet=CharSet.Unicode)] static extern int SHParseDisplayName(string name, IntPtr bind, out IntPtr pidl, uint flags, out uint attrs);
    [DllImport("shell32.dll")] static extern int SHBindToParent(IntPtr pidl, ref Guid iid, out IShellFolder folder, out IntPtr last);
    [DllImport("shell32.dll")] static extern IntPtr ILFindLastID(IntPtr pidl);
    [DllImport("user32.dll")] static extern IntPtr CreatePopupMenu();
    [DllImport("user32.dll")] static extern bool DestroyMenu(IntPtr menu);
    [DllImport("user32.dll")] static extern int GetMenuItemCount(IntPtr menu);
    [DllImport("user32.dll")] static extern uint TrackPopupMenuEx(IntPtr menu, uint flags, int x, int y, IntPtr hwnd, IntPtr rect);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point p);
    [StructLayout(LayoutKind.Sequential)] struct Point { public int x,y; }
    protected override void WndProc(ref Message m) {
      if (context != null && (m.Msg == 0x117 || m.Msg == 0x2B || m.Msg == 0x2C || m.Msg == 0x120)) {
        var third = context as IContextMenu3;
        IntPtr result;
        if (third != null && third.HandleMenuMsg2((uint)m.Msg,m.WParam,m.LParam,out result)==0) { m.Result=result; return; }
        var second = context as IContextMenu2;
        if (second != null && second.HandleMenuMsg((uint)m.Msg,m.WParam,m.LParam)==0) return;
      }
      base.WndProc(ref m);
    }
    public static void ShowFiles(string[] paths) { ShowCore(paths,true); }
    public static int InspectFiles(string[] paths) { return ShowCore(paths,false); }
    static int ShowCore(string[] paths, bool show) {
      if (paths.Length == 0) return 0;
      using (var host = new MenuHost()) {
        host.ShowInTaskbar=false; host.FormBorderStyle=FormBorderStyle.None; host.Opacity=0;
        var pidls = new IntPtr[paths.Length];
        IShellFolder folder=null; IntPtr menu=IntPtr.Zero, iface=IntPtr.Zero;
        try {
          var children = new IntPtr[paths.Length]; uint attrs;
          for(int i=0;i<paths.Length;i++) { Marshal.ThrowExceptionForHR(SHParseDisplayName(paths[i],IntPtr.Zero,out pidls[i],0,out attrs)); children[i]=ILFindLastID(pidls[i]); }
          Guid folderId = typeof(IShellFolder).GUID; IntPtr last;
          Marshal.ThrowExceptionForHR(SHBindToParent(pidls[0],ref folderId,out folder,out last));
          Guid menuId=typeof(IContextMenu).GUID;
          Marshal.ThrowExceptionForHR(folder.GetUIObjectOf(host.Handle,(uint)children.Length,children,ref menuId,IntPtr.Zero,out iface));
          host.context=(IContextMenu)Marshal.GetObjectForIUnknown(iface);
          menu=CreatePopupMenu();
          Marshal.ThrowExceptionForHR(host.context.QueryContextMenu(menu,0,1,0x7FFF,0));
          if(!show)return GetMenuItemCount(menu);
          host.Show(); SetForegroundWindow(host.Handle); Point point; GetCursorPos(out point);
          uint selected=TrackPopupMenuEx(menu,0x100|0x2,point.x,point.y,host.Handle,IntPtr.Zero);
          if(selected!=0) {
            var command=new Command { size=Marshal.SizeOf(typeof(Command)), hwnd=host.Handle, verb=new IntPtr(selected-1), show=1 };
            Marshal.ThrowExceptionForHR(host.context.InvokeCommand(ref command));
            // Shell handlers may deliver completion through the STA message queue.
            Application.DoEvents();
          }
          return GetMenuItemCount(menu);
        } finally {
          if(menu!=IntPtr.Zero) DestroyMenu(menu);
          if(host.context!=null) Marshal.ReleaseComObject(host.context);
          if(iface!=IntPtr.Zero) Marshal.Release(iface);
          if(folder!=null) Marshal.ReleaseComObject(folder);
          foreach(var pidl in pidls) if(pidl!=IntPtr.Zero) Marshal.FreeCoTaskMem(pidl);
        }
      }
    }
  }
}
