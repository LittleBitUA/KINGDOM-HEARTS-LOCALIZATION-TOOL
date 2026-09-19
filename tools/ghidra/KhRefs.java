// Decompile every function referencing the given global addresses (env KH_ADDRS, comma-separated hex),
// plus callees of those functions (one level). Output: KH_OUT/refs/<addr>_<name>.c + refs_index.txt
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import ghidra.util.task.TaskMonitor;
import java.io.*;
import java.util.*;

public class KhRefs extends GhidraScript {
  @Override
  public void run() throws Exception {
    String outDir = System.getenv("KH_OUT"); if (outDir == null) outDir = "E:/ghidra_out";
    String addrs = System.getenv("KH_ADDRS");
    File dd = new File(outDir, "refs"); dd.mkdirs();
    Program p = currentProgram;
    FunctionManager fm = p.getFunctionManager();
    ReferenceManager rm = p.getReferenceManager();
    Set<Function> direct = new LinkedHashSet<>();
    PrintWriter idx = new PrintWriter(new File(outDir, "refs_index.txt"));
    for (String a : addrs.split(",")) {
      Address addr = p.getAddressFactory().getAddress(a.trim());
      for (Reference r : rm.getReferencesTo(addr)) {
        Function f = fm.getFunctionContaining(r.getFromAddress());
        idx.println(a.trim() + "\txref " + r.getFromAddress() + "\t" + (f == null ? "?" : f.getName()));
        if (f != null) direct.add(f);
      }
    }
    Set<Function> all = new LinkedHashSet<>(direct);
    for (Function f : direct) for (Function c : f.getCalledFunctions(TaskMonitor.DUMMY)) all.add(c);
    for (Function f : direct) for (Function c : f.getCallingFunctions(TaskMonitor.DUMMY)) all.add(c);
    DecompInterface di = new DecompInterface(); di.openProgram(p);
    int n = 0;
    for (Function f : all) {
      if (n++ > 300) break;
      DecompileResults res = di.decompileFunction(f, 60, TaskMonitor.DUMMY);
      String code = (res != null && res.getDecompiledFunction() != null) ? res.getDecompiledFunction().getC() : "// failed";
      String name = f.getEntryPoint() + "_" + f.getName().replaceAll("[^A-Za-z0-9_]", "_");
      try (PrintWriter w = new PrintWriter(new OutputStreamWriter(new FileOutputStream(new File(dd, name + ".c")), "UTF-8"))) { w.print(code); }
      idx.println("decomp\t" + name + "\t" + (direct.contains(f) ? "direct" : "neighbor") + "\t" + f.getBody().getNumAddresses());
    }
    idx.close(); di.dispose();
    println("KhRefs: direct " + direct.size() + ", decompiled " + Math.min(n, 300));
  }
}
