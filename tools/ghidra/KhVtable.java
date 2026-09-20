// For every symbol whose name contains one of KH_SYMS (comma-separated, e.g. "CRsrcCTD::vftable"):
// decompile the functions the vtable points to, and the functions that reference the symbol.
// Output: KH_OUT/vt/<class>/<addr>_<name>.c + KH_OUT/vt_index.txt
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.mem.*;
import ghidra.program.model.symbol.*;
import ghidra.util.task.TaskMonitor;
import java.io.*;
import java.util.*;

public class KhVtable extends GhidraScript {
  @Override
  public void run() throws Exception {
    String outDir = System.getenv("KH_OUT"); if (outDir == null) outDir = "E:/ghidra_out/vt";
    new File(outDir).mkdirs();
    String[] syms = System.getenv("KH_SYMS").split(",");
    Program p = currentProgram;
    Memory mem = p.getMemory();
    FunctionManager fm = p.getFunctionManager();
    ReferenceManager rm = p.getReferenceManager();
    SymbolTable st = p.getSymbolTable();
    DecompInterface di = new DecompInterface(); di.openProgram(p);
    PrintWriter idx = new PrintWriter(new File(outDir, "vt_index.txt"));
    for (String want : syms) {
      want = want.trim();
      for (Symbol s : st.getAllSymbols(true)) {
        String n = s.getName(true);
        if (!n.contains(want)) continue;
        idx.println("== " + n + " @ " + s.getAddress());
        File dd = new File(outDir, "vt/" + n.replaceAll("[^A-Za-z0-9_]", "_")); dd.mkdirs();
        Set<Function> fns = new LinkedHashSet<>();
        // vtable entries: consecutive pointers into executable memory
        Address a = s.getAddress();
        for (int i = 0; i < 64; i++) {
          try {
            long v = mem.getLong(a.add(i * 8L));
            Address t = p.getAddressFactory().getDefaultAddressSpace().getAddress(v);
            Function f = fm.getFunctionAt(t);
            if (f == null) { if (i > 0) break; else continue; }
            idx.println("   vt[" + i + "] " + f.getName() + " @ " + f.getEntryPoint());
            fns.add(f);
          } catch (Exception e) { break; }
        }
        for (Reference r : rm.getReferencesTo(s.getAddress())) {
          Function f = fm.getFunctionContaining(r.getFromAddress());
          if (f != null) { idx.println("   ref " + f.getName() + " @ " + f.getEntryPoint()); fns.add(f); }
        }
        for (Function f : fns) {
          DecompileResults res = di.decompileFunction(f, 90, TaskMonitor.DUMMY);
          String code = (res != null && res.getDecompiledFunction() != null) ? res.getDecompiledFunction().getC() : "// failed";
          try (PrintWriter w = new PrintWriter(new OutputStreamWriter(new FileOutputStream(new File(dd, f.getEntryPoint() + "_" + f.getName().replaceAll("[^A-Za-z0-9_]", "_") + ".c")), "UTF-8"))) { w.print(code); }
        }
      }
    }
    idx.close(); di.dispose();
    println("KhVtable done");
  }
}
