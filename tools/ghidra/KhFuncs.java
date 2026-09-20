// Decompile functions at KH_ADDRS (comma-separated hex) plus their callees to depth KH_DEPTH (default 1).
// Output: KH_OUT/fn/<addr>_<name>.c and KH_OUT/fn_index.txt (caller → callees).
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import ghidra.util.task.TaskMonitor;
import java.io.*;
import java.util.*;

public class KhFuncs extends GhidraScript {
  @Override
  public void run() throws Exception {
    String outDir = System.getenv("KH_OUT"); if (outDir == null) outDir = "E:/ghidra_out/fn";
    File dd = new File(outDir, "fn"); dd.mkdirs();
    int depth = 1; try { depth = Integer.parseInt(System.getenv("KH_DEPTH")); } catch (Exception e) {}
    int max = 120; try { max = Integer.parseInt(System.getenv("KH_MAX")); } catch (Exception e) {}
    Program p = currentProgram;
    FunctionManager fm = p.getFunctionManager();
    Deque<Object[]> q = new ArrayDeque<>();
    for (String a : System.getenv("KH_ADDRS").split(",")) {
      Address ad = p.getAddressFactory().getDefaultAddressSpace().getAddress(Long.parseUnsignedLong(a.trim(), 16));
      Function f = fm.getFunctionAt(ad); if (f == null) f = fm.getFunctionContaining(ad);
      if (f != null) q.add(new Object[] { f, 0 });
    }
    Set<Function> done = new LinkedHashSet<>();
    DecompInterface di = new DecompInterface(); di.openProgram(p);
    PrintWriter idx = new PrintWriter(new File(outDir, "fn_index.txt"));
    while (!q.isEmpty() && done.size() < max) {
      Object[] it = q.poll();
      Function f = (Function) it[0]; int d = (Integer) it[1];
      if (done.contains(f)) continue;
      done.add(f);
      DecompileResults res = di.decompileFunction(f, 90, TaskMonitor.DUMMY);
      String code = (res != null && res.getDecompiledFunction() != null) ? res.getDecompiledFunction().getC() : "// failed";
      try (PrintWriter w = new PrintWriter(new OutputStreamWriter(new FileOutputStream(new File(dd, f.getEntryPoint() + "_" + f.getName().replaceAll("[^A-Za-z0-9_]", "_") + ".c")), "UTF-8"))) { w.print(code); }
      StringBuilder sb = new StringBuilder(f.getEntryPoint() + " " + f.getName() + " (d=" + d + ") ->");
      for (Function c : f.getCalledFunctions(TaskMonitor.DUMMY)) {
        sb.append(' ').append(c.getName());
        if (d < depth && c.getBody().getNumAddresses() > 40) q.add(new Object[] { c, d + 1 });
      }
      idx.println(sb);
    }
    idx.close(); di.dispose();
    println("KhFuncs: " + done.size());
  }
}
