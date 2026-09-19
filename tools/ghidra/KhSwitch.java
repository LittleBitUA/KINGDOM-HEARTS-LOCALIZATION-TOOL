// Find functions with a computed jump (switch) of N..M targets (env KH_MIN/KH_MAX) and decompile them.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import ghidra.util.task.TaskMonitor;
import java.io.*;
import java.util.*;

public class KhSwitch extends GhidraScript {
  @Override
  public void run() throws Exception {
    String outDir = System.getenv("KH_OUT"); if (outDir == null) outDir = "E:/ghidra_out/switch";
    int min = Integer.parseInt(System.getenv().getOrDefault("KH_MIN", "14"));
    int max = Integer.parseInt(System.getenv().getOrDefault("KH_MAX", "17"));
    File dd = new File(outDir, "sw"); dd.mkdirs();
    Program p = currentProgram;
    Listing listing = p.getListing();
    Set<Function> hits = new LinkedHashSet<>();
    PrintWriter idx = new PrintWriter(new File(outDir, "switch_index.txt"));
    for (Instruction ins : listing.getInstructions(true)) {
      if (!ins.getFlowType().isComputed() || !ins.getFlowType().isJump()) continue;
      Reference[] refs = ins.getReferencesFrom();
      int n = 0;
      Set<Address> targets = new HashSet<>();
      for (Reference r : refs) if (r.getReferenceType().isJump()) targets.add(r.getToAddress());
      n = targets.size();
      if (n < min || n > max) continue;
      Function f = listing.getFunctionContaining(ins.getAddress());
      if (f == null) continue;
      idx.println(f.getEntryPoint() + "\t" + f.getName() + "\tswitch@" + ins.getAddress() + "\ttargets=" + n + "\tsize=" + f.getBody().getNumAddresses());
      hits.add(f);
    }
    println("KhSwitch: candidate functions " + hits.size());
    DecompInterface di = new DecompInterface(); di.openProgram(p);
    int c = 0;
    for (Function f : hits) {
      if (c++ >= 400) break;
      DecompileResults res = di.decompileFunction(f, 60, TaskMonitor.DUMMY);
      String code = (res != null && res.getDecompiledFunction() != null) ? res.getDecompiledFunction().getC() : "// failed";
      String name = f.getEntryPoint() + "_" + f.getName().replaceAll("[^A-Za-z0-9_]", "_");
      try (PrintWriter w = new PrintWriter(new OutputStreamWriter(new FileOutputStream(new File(dd, name + ".c")), "UTF-8"))) { w.print(code); }
    }
    idx.close(); di.dispose();
    println("KhSwitch: decompiled " + Math.min(c, 400));
  }
}
