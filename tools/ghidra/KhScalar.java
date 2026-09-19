// Find instructions whose scalar operands equal any of KH_VALS (comma-separated hex) and decompile containing functions.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.scalar.Scalar;
import ghidra.util.task.TaskMonitor;
import java.io.*;
import java.util.*;

public class KhScalar extends GhidraScript {
  @Override
  public void run() throws Exception {
    String outDir = System.getenv("KH_OUT"); if (outDir == null) outDir = "E:/ghidra_out/scalar";
    File dd = new File(outDir, "fn"); dd.mkdirs();
    Set<Long> vals = new HashSet<>();
    for (String v : System.getenv("KH_VALS").split(",")) vals.add(Long.parseUnsignedLong(v.trim(), 16));
    Program p = currentProgram;
    Listing listing = p.getListing();
    Set<Function> hits = new LinkedHashSet<>();
    PrintWriter idx = new PrintWriter(new File(outDir, "scalar_index.txt"));
    for (Instruction ins : listing.getInstructions(true)) {
      int n = ins.getNumOperands();
      for (int i = 0; i < n; i++) {
        for (Object o : ins.getOpObjects(i)) {
          if (o instanceof Scalar) {
            long v = ((Scalar) o).getUnsignedValue();
            if (vals.contains(v)) {
              Function f = listing.getFunctionContaining(ins.getAddress());
              idx.println(Long.toHexString(v) + "\t" + ins.getAddress() + "\t" + ins + "\t" + (f == null ? "?" : f.getName()));
              if (f != null) hits.add(f);
            }
          }
        }
      }
    }
    println("KhScalar: functions " + hits.size());
    DecompInterface di = new DecompInterface(); di.openProgram(p);
    int c = 0;
    for (Function f : hits) {
      if (c++ >= 200) break;
      DecompileResults res = di.decompileFunction(f, 60, TaskMonitor.DUMMY);
      String code = (res != null && res.getDecompiledFunction() != null) ? res.getDecompiledFunction().getC() : "// failed";
      String name = f.getEntryPoint() + "_" + f.getName().replaceAll("[^A-Za-z0-9_]", "_");
      try (PrintWriter w = new PrintWriter(new OutputStreamWriter(new FileOutputStream(new File(dd, name + ".c")), "UTF-8"))) { w.print(code); }
    }
    idx.close(); di.dispose();
    println("KhScalar: decompiled " + Math.min(c, 200));
  }
}
