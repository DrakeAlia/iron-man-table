import React, { useRef, useEffect, useState } from "react";
import { Hands, Results } from "@mediapipe/hands";
import { HAND_CONNECTIONS } from "@mediapipe/hands";
import { useSupabaseTables } from "../hooks/useSupabaseTables";

interface HandTrackingProps {
  cameraId: string;
}

interface TableObject {
  id: string;
  name: string;
  x: number;
  y: number;
  isDragging: boolean;
}

interface ChartDataItem {
  id: number;
  value?: number;
  name?: string;
  title?: string;
  _table: string;
  registration_count?: number;
  [key: string]:
    | string
    | number
    | boolean
    | null
    | undefined
    | { length: number }
    | ChartDataItem;
}

interface ChartData {
  data: ChartDataItem[];
  xAxisField?: string;
  yAxisField?: string;
  yAxisLabel?: string;
  type?: string;
  title?: string;
  subtitle?: string;
  joinType?: string;
}

const HandTracking: React.FC<HandTrackingProps> = ({ cameraId }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showChart, setShowChart] = useState(false);
  const [chartAnimationState, setChartAnimationState] = useState<
    "entering" | "visible" | "exiting" | "hidden"
  >("hidden");
  const [chartData, setChartData] = useState<{
    tables: string[];
    data: ChartDataItem[];
    isEventsRegistrations?: boolean;
    joinType?: string;
    joinTitle?: string;
    joinSubtitle?: string;
    xAxisField?: string;
    yAxisField?: string;
    yAxisLabel?: string;
  }>({ tables: [], data: [] });
  const [toast, setToast] = useState<{
    message: string;
    type: "info" | "error";
  } | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const chartAnimationStartRef = useRef<number>(0);
  const {
    tables: availableTables,
    relationships,
    loading: tablesLoading,
  } = useSupabaseTables();

  // Helper function to mirror hand coordinates
  const mirrorX = (x: number, canvasWidth: number) => {
    return canvasWidth - x * canvasWidth;
  };

  // Use refs for mutable state to avoid re-renders during drag
  const tablesRef = useRef<TableObject[]>([]);
  const draggedTableRef = useRef<string | null>(null);
  const tablesInitialized = useRef(false);
  const droppedTablesRef = useRef<string[]>([]); // Tables in drop zone
  const generateButtonHoverRef = useRef(false);
  const buttonClickedRef = useRef(false);

  const pinchStateRef = useRef<{
    isPinching: boolean;
    x: number;
    y: number;
  }>({ isPinching: false, x: 0, y: 0 });

  const swipeStateRef = useRef<{
    isTracking: boolean;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    startTime: number;
  }>({
    isTracking: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    startTime: 0,
  });

  const handResultsRef = useRef<Results | null>(null);

  // Drop zone configuration
  const dropZone = {
    x: 0.5,
    y: 0.7,
    width: 0.3,
    height: 0.2,
  };

  // Show toast notification
  const showToast = (message: string, type: "info" | "error" = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Chart animation functions
  const showChartWithAnimation = () => {
    setShowChart(true);
    setChartAnimationState("entering");
    chartAnimationStartRef.current = Date.now();

    // After entrance animation completes
    setTimeout(() => {
      setChartAnimationState("visible");
    }, 800);
  };

  const hideChartWithAnimation = () => {
    setChartAnimationState("exiting");
    chartAnimationStartRef.current = Date.now();

    // After exit animation completes
    setTimeout(() => {
      setShowChart(false);
      setChartAnimationState("hidden");
      setChartData({ tables: [], data: [] });
      droppedTablesRef.current = [];
    }, 600);
  };

  // Find schema-based relationships between two tables
  const findSchemaRelationship = (table1: string, table2: string) => {
    return relationships.find(
      (rel) =>
        (rel.table1.toLowerCase() === table1.toLowerCase() &&
          rel.table2.toLowerCase() === table2.toLowerCase()) ||
        (rel.table1.toLowerCase() === table2.toLowerCase() &&
          rel.table2.toLowerCase() === table1.toLowerCase())
    );
  };

  // Determine the best x-axis field based on priority: date > title/name > id
  const getBestXAxisField = (data: ChartDataItem[]) => {
    if (!data || data.length === 0) return "id";

    const sampleItem = data[0];
    const fields = Object.keys(sampleItem).filter(
      (key) => !key.startsWith("_")
    );

    // First priority: Date fields
    const dateFields = [
      "created",
      "createdAt",
      "created_at",
      "updatedAt",
      "updated_at",
      "date",
      "timestamp",
    ];
    for (const field of dateFields) {
      if (fields.includes(field)) {
        return field;
      }
    }

    // Second priority: Title/name fields
    const titleField = fields.find((f) => f.toLowerCase().includes("title"));
    if (titleField) return titleField;

    const nameField = fields.find((f) => f.toLowerCase().includes("name"));
    if (nameField) return nameField;

    // Third priority: ID
    if (fields.includes("id")) return "id";

    // Fallback: first available field
    return fields[0] || "id";
  };

  // Create intelligent join queries based on table relationships
  const createJoinQuery = async (tableNames: string[]) => {
    if (tableNames.length !== 2) return null;

    const [table1, table2] = tableNames;
    const relationship = findSchemaRelationship(table1, table2);

    if (!relationship) return null;

    try {
      const { supabase } = await import("../lib/supabase");

      // Determine query strategy based on table names and relationship
      const referencingTable = relationship.referencingTable;
      const referencedTable = relationship.referencedTable;
      const foreignKey = relationship.foreignKey;

      // Strategy 1: Users + Posts/Comments/Orders (show user activity)
      if (
        referencedTable.toLowerCase().includes("user") ||
        referencedTable.toLowerCase().includes("customer")
      ) {
        const { data, error } = await supabase.from(referencedTable).select(`
            id,
            name,
            email,
            title,
            created,
            createdAt,
            created_at,
            date
          `);

        if (!error && data) {
          const processedData = data.map((user: Record<string, unknown>) => ({
            ...user,
            id: typeof user.id === "number" ? user.id : Number(user.id) || 0,
            activity_count: 0,
            _table: referencedTable,
          }));

          return {
            type: "user_activity",
            title: `${referencedTable.toUpperCase()} ACTIVITY`,
            subtitle: `${referencingTable} per ${referencedTable}`,
            data: processedData,
            xAxisField: getBestXAxisField(processedData),
            yAxisField: "activity_count",
            yAxisLabel: referencingTable.toUpperCase(),
          };
        }
      }

      // Strategy 2: Categories + Products (show category popularity)
      if (
        referencedTable.toLowerCase().includes("categor") ||
        referencingTable.toLowerCase().includes("product") ||
        referencingTable.toLowerCase().includes("item")
      ) {
        const { data, error } = await supabase.from(referencedTable).select(`
            id,
            name,
            title,
            created,
            createdAt,
            created_at,
            date
          `);

        if (!error && data) {
          const processedData = data.map(
            (category: Record<string, unknown>) => ({
              ...category,
              id:
                typeof category.id === "number"
                  ? category.id
                  : Number(category.id) || 0,
              item_count: 0,
              _table: referencedTable,
            })
          );

          return {
            type: "category_distribution",
            title: "CATEGORY DISTRIBUTION",
            subtitle: `${referencingTable} per ${referencedTable}`,
            data: processedData,
            xAxisField: getBestXAxisField(processedData),
            yAxisField: "item_count",
            yAxisLabel: referencingTable.toUpperCase(),
          };
        }
      }

      // Strategy 3: Generic aggregation (count references)
      const { data, error } = await supabase.from(referencingTable).select(`
          ${foreignKey}
        `);

      if (!error && data) {
        // Group and count by referenced item
        const counts = new Map<
          string,
          { id: number; count: number; name: string; _table: string }
        >();
        (data as unknown as Record<string, unknown>[]).forEach(
          (item: Record<string, unknown>) => {
            const referencedItemId = item[foreignKey] as string;
            if (referencedItemId) {
              const key = referencedItemId;
              const displayName = `${referencingTable} ${referencedItemId}`;

              if (!counts.has(key)) {
                counts.set(key, {
                  id: Number(referencedItemId) || 0,
                  name: displayName,
                  count: 0,
                  _table: referencingTable,
                });
              }
              const existing = counts.get(key);
              if (existing) {
                existing.count++;
              }
            }
          }
        );

        const processedData = Array.from(counts.values());

        return {
          type: "relationship_count",
          title: "RELATIONSHIP ANALYSIS",
          subtitle: `${referencingTable} → ${referencedTable}`,
          data: processedData,
          xAxisField: getBestXAxisField(processedData),
          yAxisField: "count",
          yAxisLabel: "COUNT",
        };
      }
    } catch (err) {
      console.error("Error creating join query:", err);
    }

    return null;
  };

  // Detect reference columns between tables
  const detectTableRelationships = (
    tableNames: string[],
    allData: ChartDataItem[]
  ): {
    foreignKey: string;
    referencingTable: string;
    referencedTable: string;
    referencingData: ChartDataItem[];
    referencedData: ChartDataItem[];
  } | null => {
    if (tableNames.length !== 2) return null;

    const [table1, table2] = tableNames;
    const table1Data = allData.filter(
      (item: ChartDataItem) => item._table === table1
    );
    const table2Data = allData.filter(
      (item: ChartDataItem) => item._table === table2
    );

    if (table1Data.length === 0 || table2Data.length === 0) return null;

    // Get column names for both tables
    const table1Columns = Object.keys(table1Data[0] || {}).filter(
      (key) => !key.startsWith("_")
    );
    const table2Columns = Object.keys(table2Data[0] || {}).filter(
      (key) => !key.startsWith("_")
    );

    // Look for reference columns (foreign keys)
    let foreignKey = null;
    let referencedTable = null;
    let referencingTable = null;

    // Check if table1 has a reference to table2 (e.g., table1 has "table2_id" or "table2Id")
    const table2RefColumns = table1Columns.filter(
      (col) =>
        col.toLowerCase().includes(table2.toLowerCase()) ||
        col.toLowerCase() === `${table2.toLowerCase()}_id` ||
        col.toLowerCase() === `${table2.toLowerCase()}id`
    );

    if (table2RefColumns.length > 0) {
      foreignKey = table2RefColumns[0];
      referencingTable = table1;
      referencedTable = table2;
    } else {
      // Check if table2 has a reference to table1
      const table1RefColumns = table2Columns.filter(
        (col) =>
          col.toLowerCase().includes(table1.toLowerCase()) ||
          col.toLowerCase() === `${table1.toLowerCase()}_id` ||
          col.toLowerCase() === `${table1.toLowerCase()}id`
      );

      if (table1RefColumns.length > 0) {
        foreignKey = table1RefColumns[0];
        referencingTable = table2;
        referencedTable = table1;
      }
    }

    if (!foreignKey || !referencingTable || !referencedTable) return null;

    return {
      foreignKey,
      referencingTable,
      referencedTable,
      referencingData: referencingTable === table1 ? table1Data : table2Data,
      referencedData: referencedTable === table1 ? table1Data : table2Data,
    };
  };

  // Special handling for events + registrations tables
  const fetchEventsRegistrationsData = async () => {
    setLoadingData(true);
    try {
      const { supabase } = await import("../lib/supabase");

      // Perform join query to get events with registration counts
      const { data, error } = await supabase.from("events").select(`
          id,
          title,
          name,
          registrations:registrations(count)
        `);

      if (error) {
        console.error("Error fetching events with registrations:", error);
        // Fallback to separate queries if join fails
        return await fetchSeparateEventsRegistrations();
      }

      // Transform the data to include registration counts
      const eventsWithCounts =
        data?.map((event) => ({
          ...event,
          registration_count: event.registrations?.length || 0,
          _table: "events",
        })) || [];

      setChartData({
        tables: ["events", "registrations"],
        data: eventsWithCounts,
        isEventsRegistrations: true,
      });
      setLoadingData(false);
    } catch (err) {
      console.error("Error loading events and registrations:", err);
      await fetchSeparateEventsRegistrations();
    }
  };

  // Fallback method using separate queries
  const fetchSeparateEventsRegistrations = async () => {
    try {
      const { supabase } = await import("../lib/supabase");

      // Get events
      const { data: events, error: eventsError } = await supabase
        .from("events")
        .select("*");

      // Get registrations
      const { data: registrations, error: registrationsError } = await supabase
        .from("registrations")
        .select("*");

      if (eventsError || registrationsError) {
        throw new Error("Failed to fetch events or registrations");
      }

      // Count registrations per event
      const eventCounts = new Map();
      events?.forEach((event) => {
        eventCounts.set(event.id, { ...event, registration_count: 0 });
      });

      // Count registrations by event_id
      registrations?.forEach((registration) => {
        const eventId =
          registration.event_id ||
          registration.eventId ||
          registration.events_id;
        if (eventId && eventCounts.has(eventId)) {
          const event = eventCounts.get(eventId);
          event.registration_count++;
        }
      });

      const eventsWithCounts = Array.from(eventCounts.values()).map(
        (event) => ({
          ...event,
          _table: "events",
        })
      );

      setChartData({
        tables: ["events", "registrations"],
        data: eventsWithCounts,
        isEventsRegistrations: true,
      });
      setLoadingData(false);
    } catch (err) {
      console.error("Error in fallback query:", err);
      setLoadingData(false);
      // Use demo data for events and registrations
      const demoEvents = Array.from({ length: 8 }, (_, i) => ({
        id: i + 1,
        title: `Event ${i + 1}`,
        name: `Conference ${i + 1}`,
        registration_count: Math.floor(Math.random() * 50) + 5,
        _table: "events",
      }));

      setChartData({
        tables: ["events", "registrations"],
        data: demoEvents,
        isEventsRegistrations: true,
      });
    }
  };

  // Fetch data from Supabase tables
  const fetchTableData = async (tableNames: string[]) => {
    // Check for special events + registrations combination
    const hasEvents = tableNames.some((name) =>
      name.toLowerCase().includes("event")
    );
    const hasRegistrations = tableNames.some((name) =>
      name.toLowerCase().includes("registration")
    );

    if (hasEvents && hasRegistrations && tableNames.length === 2) {
      return await fetchEventsRegistrationsData();
    }

    // Check for schema-based relationships for intelligent join queries
    if (tableNames.length === 2 && relationships.length > 0) {
      const joinResult = await createJoinQuery(tableNames);
      if (joinResult) {
        setChartData({
          tables: tableNames,
          data: joinResult.data,
          joinType: joinResult.type,
          joinTitle: joinResult.title,
          joinSubtitle: joinResult.subtitle,
          xAxisField: joinResult.xAxisField,
          yAxisField: joinResult.yAxisField,
          yAxisLabel: joinResult.yAxisLabel,
        });
        setLoadingData(false);
        return;
      }
    }

    setLoadingData(true);
    try {
      const { supabase } = await import("../lib/supabase");
      const allData: ChartDataItem[] = [];

      for (const tableName of tableNames) {
        try {
          const { data, error } = await supabase.from(tableName).select("*");

          if (error) {
            console.error(`Error fetching ${tableName}:`, error);
            continue;
          }

          if (data && data.length > 0) {
            // Add table source to each record
            data.forEach((record) => {
              allData.push({ ...record, _table: tableName });
            });
          }
        } catch (err) {
          console.error(`Failed to fetch ${tableName}:`, err);
        }
      }

      setChartData({ tables: tableNames, data: allData });
      setLoadingData(false);
    } catch (err) {
      console.error("Error loading Supabase:", err);
      setLoadingData(false);
      // Use demo data if Supabase fails with relationships
      const demoData = tableNames.flatMap((table, tableIndex) =>
        Array.from({ length: 5 }, (_, i) => {
          const baseRecord = {
            id: i + 1,
            value: Math.random() * 100,
            name: `${table} Item ${i + 1}`,
            title: `${table} Title ${i + 1}`,
            _table: table,
          };

          // Add foreign key relationships for demo
          if (tableNames.length === 2 && tableIndex === 1) {
            // Second table references first table
            const foreignKeyField = `${tableNames[0]}_id`;
            (baseRecord as Record<string, unknown>)[foreignKeyField] =
              Math.floor(Math.random() * 5) + 1;
          }

          return baseRecord;
        })
      );
      setChartData({ tables: tableNames, data: demoData });
    }
  };

  // Render chart once when data changes
  useEffect(() => {
    if (!showChart) return;

    // Small delay to ensure canvas is mounted
    const timer = setTimeout(() => {
      if (!chartCanvasRef.current) {
        console.error("Chart canvas not found");
        return;
      }

      const ctx = chartCanvasRef.current.getContext("2d");
      if (!ctx) {
        console.error("Could not get chart context");
        return;
      }

      console.log("Rendering chart with data:", chartData);
      chartCanvasRef.current.width = window.innerWidth;
      chartCanvasRef.current.height = window.innerHeight;

      renderChartView(ctx);
    }, 100);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showChart, chartData, loadingData, chartAnimationState]);

  // Join query chart rendering function
  const renderJoinQueryChart = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    chartData: ChartData
  ) => {
    const data = chartData.data;
    const xField = chartData.xAxisField || "name";
    const yField = chartData.yAxisField || "count";

    // Title background panel
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.fillRect(width / 2 - 350, 40, 700, 100);
    ctx.strokeStyle = "#00FFFF";
    ctx.lineWidth = 2;
    ctx.strokeRect(width / 2 - 350, 40, 700, 100);

    // Chart title
    ctx.fillStyle = "#00FFFF";
    ctx.font = "bold 32px monospace";
    ctx.textAlign = "center";
    ctx.shadowBlur = 20;
    ctx.shadowColor = "#00FFFF";
    ctx.fillText(chartData.title || "JOIN QUERY ANALYSIS", width / 2, 75);

    // Subtitle
    ctx.font = "16px monospace";
    ctx.fillStyle = "#00CED1";
    ctx.shadowBlur = 10;
    ctx.fillText(
      chartData.subtitle || "Schema-based Join Query",
      width / 2,
      95
    );
    ctx.fillText(`${data.length} Records Found`, width / 2, 115);

    if (data.length === 0) {
      ctx.fillStyle = "#FFD700";
      ctx.font = "20px monospace";
      ctx.textAlign = "center";
      ctx.fillText("NO DATA FOUND IN JOIN QUERY", width / 2, height / 2);
      return;
    }

    // Check if x-field is a date field
    const dateFields = [
      "created",
      "createdAt",
      "created_at",
      "updatedAt",
      "updated_at",
      "date",
      "timestamp",
    ];
    const isDateField = dateFields.includes(xField);

    let processedData;
    if (isDateField) {
      // Group by date for date fields
      const dateGroups = new Map();
      data.forEach((item: ChartDataItem) => {
        const dateValue = item[xField];
        if (
          dateValue &&
          (typeof dateValue === "string" ||
            typeof dateValue === "number" ||
            dateValue instanceof Date)
        ) {
          const date = new Date(dateValue);
          const dateKey = date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          });

          if (!dateGroups.has(dateKey)) {
            dateGroups.set(dateKey, {
              [xField]: dateKey,
              [yField]: 0,
              count: 0,
            });
          }

          const group = dateGroups.get(dateKey);
          group[yField] += item[yField] || 0;
          group.count++;
        }
      });

      processedData = Array.from(dateGroups.values()).sort((a, b) => {
        const dateA = new Date(a[xField]);
        const dateB = new Date(b[xField]);
        return dateA.getTime() - dateB.getTime();
      });
    } else {
      // Sort data by y-field value (descending) for non-date fields
      processedData = [...data].sort((a, b) => {
        const aValue =
          typeof a[yField] === "number" ? (a[yField] as number) : 0;
        const bValue =
          typeof b[yField] === "number" ? (b[yField] as number) : 0;
        return bValue - aValue;
      });
    }

    // Render bars - show more data but limit for visual clarity
    const maxItems = Math.min(processedData.length, 25);
    const barWidth = (width * 0.7) / maxItems;
    const barSpacing = barWidth * 0.1;
    const chartHeight = height * 0.4;
    const chartY = height * 0.75;
    const startX = width * 0.15;

    // Chart area background
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(
      startX - 50,
      chartY - chartHeight - 50,
      width * 0.7 + 100,
      chartHeight + 100
    );
    ctx.strokeStyle = "rgba(0, 255, 255, 0.3)";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      startX - 50,
      chartY - chartHeight - 50,
      width * 0.7 + 100,
      chartHeight + 100
    );

    const maxValue = Math.max(...processedData.map((d) => d[yField] || 0));

    // Color schemes based on join type
    let colorScheme = ["#00FFFF", "#00CED1", "#006B6B"]; // Default cyan
    if (chartData.joinType === "user_activity") {
      colorScheme = ["#32CD32", "#00FF00", "#006400"]; // Green for users
    } else if (chartData.joinType === "category_distribution") {
      colorScheme = ["#FF69B4", "#FF1493", "#8B008B"]; // Pink for categories
    }

    // Draw bars
    processedData.slice(0, maxItems).forEach((item, i) => {
      const barHeight =
        maxValue > 0 ? ((item[yField] || 0) / maxValue) * chartHeight * 0.8 : 0;
      const x = startX + i * (barWidth + barSpacing);
      const y = chartY - barHeight;

      // Bar gradient
      const gradient = ctx.createLinearGradient(x, y, x, chartY);
      gradient.addColorStop(0, colorScheme[0]);
      gradient.addColorStop(0.5, colorScheme[1]);
      gradient.addColorStop(1, colorScheme[2]);

      // Draw bar
      ctx.fillStyle = gradient;
      ctx.shadowBlur = 15;
      ctx.shadowColor = colorScheme[0];
      ctx.fillRect(x, y, barWidth * 0.8, barHeight);

      // Value on top of bar
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.shadowBlur = 5;
      ctx.fillText((item[yField] || 0).toString(), x + barWidth / 2, y - 5);

      // Label (rotated)
      ctx.save();
      ctx.translate(x + barWidth / 2, chartY + 10);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = colorScheme[0];
      ctx.font = "10px monospace";
      ctx.textAlign = "right";
      const label = item[xField] || `Item ${item.id || i + 1}`;
      const truncatedLabel =
        label.length > 20 ? label.substring(0, 17) + "..." : label;
      ctx.fillText(truncatedLabel, 0, 0);
      ctx.restore();
    });

    // Y-axis label
    ctx.fillStyle = "#00FFFF";
    ctx.font = "14px monospace";
    ctx.textAlign = "center";
    ctx.save();
    ctx.translate(startX - 40, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(chartData.yAxisLabel || "COUNT", 0, 0);
    ctx.restore();

    // X-axis label
    ctx.fillStyle = "#00FFFF";
    ctx.font = "14px monospace";
    ctx.textAlign = "center";
    ctx.fillText(xField.toUpperCase(), width / 2, chartY + 60);

    // X-axis line
    ctx.strokeStyle = "#00FFFF";
    ctx.lineWidth = 2;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(startX - 20, chartY);
    ctx.lineTo(startX + maxItems * (barWidth + barSpacing), chartY);
    ctx.stroke();

    // Statistics box
    const statsY = height * 0.15;
    const totalValue = processedData.reduce(
      (sum, item) => sum + (item[yField] || 0),
      0
    );
    const avgValue =
      processedData.length > 0
        ? (totalValue / processedData.length).toFixed(1)
        : "0";

    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.fillRect(width - 350, statsY, 320, 100);
    ctx.strokeStyle = colorScheme[0];
    ctx.lineWidth = 1;
    ctx.strokeRect(width - 350, statsY, 320, 100);

    ctx.fillStyle = colorScheme[0];
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "left";
    ctx.fillText("JOIN STATISTICS:", width - 340, statsY + 20);
    ctx.font = "10px monospace";
    ctx.fillStyle = colorScheme[1];
    ctx.fillText(
      `Total Records: ${processedData.length}`,
      width - 340,
      statsY + 40
    );
    ctx.fillText(
      `Total ${chartData.yAxisLabel || "Value"}: ${totalValue}`,
      width - 340,
      statsY + 55
    );
    ctx.fillText(`Average: ${avgValue}`, width - 340, statsY + 70);
    ctx.fillText(`Max: ${maxValue}`, width - 340, statsY + 85);
  };

  // Events + Registrations chart rendering function
  const renderEventsRegistrationsChart = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    chartData: ChartData
  ) => {
    const events = chartData.data.filter(
      (item): item is ChartDataItem & { registration_count: number } =>
        item.registration_count !== undefined
    );

    // Title background panel
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.fillRect(width / 2 - 300, 40, 600, 100);
    ctx.strokeStyle = "#00FFFF";
    ctx.lineWidth = 2;
    ctx.strokeRect(width / 2 - 300, 40, 600, 100);

    // Chart title
    ctx.fillStyle = "#00FFFF";
    ctx.font = "bold 28px monospace";
    ctx.textAlign = "center";
    ctx.shadowBlur = 20;
    ctx.shadowColor = "#00FFFF";
    ctx.fillText("EVENT REGISTRATIONS", width / 2, 75);

    // Subtitle
    ctx.font = "14px monospace";
    ctx.fillStyle = "#00CED1";
    ctx.shadowBlur = 10;
    ctx.fillText("EVENTS × REGISTRATIONS JOIN QUERY", width / 2, 95);
    ctx.fillText(`${events.length} Events Found`, width / 2, 115);

    if (events.length === 0) {
      ctx.fillStyle = "#FFD700";
      ctx.font = "20px monospace";
      ctx.textAlign = "center";
      ctx.fillText("NO EVENTS WITH REGISTRATIONS FOUND", width / 2, height / 2);
      return;
    }

    // Sort events by registration count (descending)
    const sortedEvents = events.sort(
      (a, b) => b.registration_count - a.registration_count
    );

    // Render event registration bars - show more data
    const maxItems = Math.min(sortedEvents.length, 20);
    const barWidth = (width * 0.7) / maxItems;
    const barSpacing = barWidth * 0.1;
    const chartHeight = height * 0.4;
    const chartY = height * 0.75;
    const startX = width * 0.15;

    // Chart area background
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(
      startX - 50,
      chartY - chartHeight - 50,
      width * 0.7 + 100,
      chartHeight + 100
    );
    ctx.strokeStyle = "rgba(0, 255, 255, 0.3)";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      startX - 50,
      chartY - chartHeight - 50,
      width * 0.7 + 100,
      chartHeight + 100
    );

    const maxCount = Math.max(...sortedEvents.map((e) => e.registration_count));

    // Draw bars for each event
    sortedEvents.slice(0, maxItems).forEach((event, i) => {
      const barHeight =
        maxCount > 0
          ? (event.registration_count / maxCount) * chartHeight * 0.8
          : 0;
      const x = startX + i * (barWidth + barSpacing);
      const y = chartY - barHeight;

      // Bar gradient - special color scheme for events
      const gradient = ctx.createLinearGradient(x, y, x, chartY);
      gradient.addColorStop(0, "#FFD700"); // Gold
      gradient.addColorStop(0.5, "#FFA500"); // Orange
      gradient.addColorStop(1, "#FF8C00"); // Dark orange

      // Draw bar
      ctx.fillStyle = gradient;
      ctx.shadowBlur = 15;
      ctx.shadowColor = "#FFD700";
      ctx.fillRect(x, y, barWidth * 0.8, barHeight);

      // Registration count on top of bar
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.shadowBlur = 5;
      ctx.fillText(
        event.registration_count.toString(),
        x + barWidth / 2,
        y - 5
      );

      // Event title (rotated)
      ctx.save();
      ctx.translate(x + barWidth / 2, chartY + 10);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = "#FFD700";
      ctx.font = "10px monospace";
      ctx.textAlign = "right";
      const eventTitle = event.title || event.name || `Event ${event.id}`;
      const truncatedTitle =
        eventTitle.length > 20
          ? eventTitle.substring(0, 17) + "..."
          : eventTitle;
      ctx.fillText(truncatedTitle, 0, 0);
      ctx.restore();
    });

    // Y-axis label
    ctx.fillStyle = "#00FFFF";
    ctx.font = "14px monospace";
    ctx.textAlign = "center";
    ctx.save();
    ctx.translate(startX - 40, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("REGISTRATIONS", 0, 0);
    ctx.restore();

    // X-axis label
    ctx.fillStyle = "#00FFFF";
    ctx.font = "14px monospace";
    ctx.textAlign = "center";
    ctx.fillText("EVENTS", width / 2, chartY + 60);

    // X-axis line
    ctx.strokeStyle = "#00FFFF";
    ctx.lineWidth = 2;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(startX - 20, chartY);
    ctx.lineTo(startX + maxItems * (barWidth + barSpacing), chartY);
    ctx.stroke();

    // Statistics box
    const statsY = height * 0.15;
    const totalRegistrations = events.reduce(
      (sum, event) => sum + event.registration_count,
      0
    );
    const avgRegistrations =
      events.length > 0 ? (totalRegistrations / events.length).toFixed(1) : "0";

    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.fillRect(width - 320, statsY, 290, 100);
    ctx.strokeStyle = "#FFD700";
    ctx.lineWidth = 1;
    ctx.strokeRect(width - 320, statsY, 290, 100);

    ctx.fillStyle = "#FFD700";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "left";
    ctx.fillText("STATISTICS:", width - 310, statsY + 20);
    ctx.font = "10px monospace";
    ctx.fillStyle = "#FFA500";
    ctx.fillText(`Total Events: ${events.length}`, width - 310, statsY + 40);
    ctx.fillText(
      `Total Registrations: ${totalRegistrations}`,
      width - 310,
      statsY + 55
    );
    ctx.fillText(
      `Avg per Event: ${avgRegistrations}`,
      width - 310,
      statsY + 70
    );
    ctx.fillText(`Max: ${maxCount} registrations`, width - 310, statsY + 85);
  };

  // Relationship chart rendering function
  const renderRelationshipChart = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    relationship: {
      referencingTable: string;
      referencedTable: string;
      foreignKey: string;
      referencingData: ChartDataItem[];
      referencedData: ChartDataItem[];
    }
  ) => {
    // Get title/name fields for both tables
    const getTitleField = (data: ChartDataItem[]) => {
      if (data.length === 0) return null;
      const fields = Object.keys(data[0]).filter((key) => !key.startsWith("_"));
      return (
        fields.find((f) => f.toLowerCase().includes("title")) ||
        fields.find((f) => f.toLowerCase().includes("name")) ||
        "id"
      );
    };

    const referencingTitleField = getTitleField(relationship.referencingData);
    const referencedTitleField = getTitleField(relationship.referencedData);

    // Calculate relationship counts
    const relationshipCounts = new Map();

    relationship.referencingData.forEach((item: ChartDataItem) => {
      const foreignKeyValue = item[relationship.foreignKey];
      const referencedItem = relationship.referencedData.find(
        (ref: ChartDataItem) => ref.id === foreignKeyValue
      );

      if (referencedItem) {
        const referencingTitle =
          (referencingTitleField ? item[referencingTitleField] : null) ||
          `${relationship.referencingTable} ${item.id}`;
        const referencedTitle =
          (referencedTitleField
            ? referencedItem[referencedTitleField]
            : null) || `${relationship.referencedTable} ${referencedItem.id}`;

        const key = `${referencedTitle}`;
        if (!relationshipCounts.has(key)) {
          relationshipCounts.set(key, {
            referencedTitle,
            count: 0,
            referencingItems: [],
          });
        }

        const entry = relationshipCounts.get(key);
        entry.count++;
        entry.referencingItems.push(referencingTitle);
      }
    });

    const relationships = Array.from(relationshipCounts.values()).sort(
      (a, b) => b.count - a.count
    );

    // Title background panel
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.fillRect(width / 2 - 300, 40, 600, 100);
    ctx.strokeStyle = "#00FFFF";
    ctx.lineWidth = 2;
    ctx.strokeRect(width / 2 - 300, 40, 600, 100);

    // Chart title
    ctx.fillStyle = "#00FFFF";
    ctx.font = "bold 28px monospace";
    ctx.textAlign = "center";
    ctx.shadowBlur = 20;
    ctx.shadowColor = "#00FFFF";
    ctx.fillText("RELATIONSHIP ANALYSIS", width / 2, 75);

    // Subtitle with relationship info
    ctx.font = "14px monospace";
    ctx.fillStyle = "#00CED1";
    ctx.shadowBlur = 10;
    ctx.fillText(
      `${relationship.referencingTable.toUpperCase()} → ${relationship.referencedTable.toUpperCase()}`,
      width / 2,
      95
    );
    ctx.fillText(`Foreign Key: ${relationship.foreignKey}`, width / 2, 115);

    if (relationships.length === 0) {
      ctx.fillStyle = "#FFD700";
      ctx.font = "20px monospace";
      ctx.textAlign = "center";
      ctx.fillText("NO VALID RELATIONSHIPS FOUND", width / 2, height / 2);
      return;
    }

    // Render relationship bars - show more data
    const maxItems = Math.min(relationships.length, 25);
    const barWidth = (width * 0.7) / maxItems;
    const barSpacing = barWidth * 0.1;
    const chartHeight = height * 0.4;
    const chartY = height * 0.75;
    const startX = width * 0.15;

    // Chart area background
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(
      startX - 50,
      chartY - chartHeight - 50,
      width * 0.7 + 100,
      chartHeight + 100
    );
    ctx.strokeStyle = "rgba(0, 255, 255, 0.3)";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      startX - 50,
      chartY - chartHeight - 50,
      width * 0.7 + 100,
      chartHeight + 100
    );

    const maxCount = Math.max(...relationships.map((r) => r.count));

    // Draw relationship bars
    relationships.slice(0, maxItems).forEach((rel, i) => {
      const barHeight = (rel.count / maxCount) * chartHeight * 0.8;
      const x = startX + i * (barWidth + barSpacing);
      const y = chartY - barHeight;

      // Bar gradient
      const gradient = ctx.createLinearGradient(x, y, x, chartY);
      gradient.addColorStop(0, "#00FFFF");
      gradient.addColorStop(0.5, "#00CED1");
      gradient.addColorStop(1, "#006B6B");

      // Draw bar
      ctx.fillStyle = gradient;
      ctx.shadowBlur = 15;
      ctx.shadowColor = "#00FFFF";
      ctx.fillRect(x, y, barWidth * 0.8, barHeight);

      // Count label on top of bar
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.shadowBlur = 5;
      ctx.fillText(rel.count.toString(), x + barWidth / 2, y - 5);

      // Referenced item name (rotated)
      ctx.save();
      ctx.translate(x + barWidth / 2, chartY + 10);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = "#00FFFF";
      ctx.font = "10px monospace";
      ctx.textAlign = "right";
      const truncatedTitle =
        rel.referencedTitle.length > 20
          ? rel.referencedTitle.substring(0, 17) + "..."
          : rel.referencedTitle;
      ctx.fillText(truncatedTitle, 0, 0);
      ctx.restore();
    });

    // Y-axis label
    ctx.fillStyle = "#00FFFF";
    ctx.font = "14px monospace";
    ctx.textAlign = "center";
    ctx.save();
    ctx.translate(startX - 40, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("REFERENCE COUNT", 0, 0);
    ctx.restore();

    // X-axis label
    ctx.fillStyle = "#00FFFF";
    ctx.font = "14px monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      relationship.referencedTable.toUpperCase() + " ITEMS",
      width / 2,
      chartY + 60
    );

    // Legend
    const legendY = height * 0.15;
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.fillRect(width - 350, legendY, 320, 80);
    ctx.strokeStyle = "#00FFFF";
    ctx.lineWidth = 1;
    ctx.strokeRect(width - 350, legendY, 320, 80);

    ctx.fillStyle = "#00FFFF";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "left";
    ctx.fillText("LEGEND:", width - 340, legendY + 20);
    ctx.font = "10px monospace";
    ctx.fillStyle = "#00CED1";
    ctx.fillText(
      `Each bar shows how many ${relationship.referencingTable}`,
      width - 340,
      legendY + 40
    );
    ctx.fillText(
      `records reference each ${relationship.referencedTable} item`,
      width - 340,
      legendY + 55
    );
    ctx.fillText(`via ${relationship.foreignKey}`, width - 340, legendY + 70);
  };

  // Chart rendering function
  const renderChartView = (ctx: CanvasRenderingContext2D) => {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;

    // Clear the canvas first
    ctx.clearRect(0, 0, width, height);

    // Calculate animation progress
    let animationProgress = 1;
    let scale = 1;
    let opacity = 1;

    if (chartAnimationState === "entering") {
      const elapsed = Date.now() - chartAnimationStartRef.current;
      animationProgress = Math.min(elapsed / 800, 1); // 800ms entrance
      // Easing function for smooth animation
      const eased = 1 - Math.pow(1 - animationProgress, 3);
      scale = 0.3 + 0.7 * eased;
      opacity = eased;
    } else if (chartAnimationState === "exiting") {
      const elapsed = Date.now() - chartAnimationStartRef.current;
      animationProgress = Math.min(elapsed / 600, 1); // 600ms exit
      // Easing function for smooth animation
      const eased = 1 - Math.pow(1 - animationProgress, 2);
      scale = 1 - 0.7 * eased;
      opacity = 1 - eased;
    }

    // Apply transformations for animation
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.translate(width / 2, height / 2);
    ctx.scale(scale, scale);
    ctx.translate(-width / 2, -height / 2);

    // Very light overlay for better text visibility
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.fillRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = "rgba(0, 255, 255, 0.1)";
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Title background panel
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.fillRect(width / 2 - 250, 40, 500, 80);
    ctx.strokeStyle = "#00FFFF";
    ctx.lineWidth = 2;
    ctx.strokeRect(width / 2 - 250, 40, 500, 80);

    // Chart title
    ctx.fillStyle = "#00FFFF";
    ctx.font = "bold 32px monospace";
    ctx.textAlign = "center";
    ctx.shadowBlur = 20;
    ctx.shadowColor = "#00FFFF";
    ctx.fillText("DATA VISUALIZATION", width / 2, 80);

    // Subtitle with table names
    ctx.font = "16px monospace";
    ctx.fillStyle = "#00CED1";
    ctx.shadowBlur = 10;
    ctx.fillText(chartData.tables.join(" × ").toUpperCase(), width / 2, 110);

    // Loading indicator
    if (loadingData) {
      ctx.fillStyle = "#00FFFF";
      ctx.font = "20px monospace";
      ctx.textAlign = "center";
      ctx.fillText("LOADING DATA...", width / 2, height / 2);
      return;
    }

    // Data visualization
    if (chartData.data.length > 0) {
      // Check for special events + registrations case
      if (chartData.isEventsRegistrations) {
        renderEventsRegistrationsChart(ctx, width, height, chartData);

        // Restore context for animation transformations
        ctx.restore();
        return;
      }

      // Check for schema-based join queries
      if (chartData.joinType) {
        renderJoinQueryChart(ctx, width, height, chartData);

        // Restore context for animation transformations
        ctx.restore();
        return;
      }

      // Check for table relationships (only for 2 tables)
      const relationship = detectTableRelationships(
        chartData.tables,
        chartData.data
      );

      if (relationship && chartData.tables.length === 2) {
        // Render relationship visualization
        renderRelationshipChart(ctx, width, height, relationship);

        // Restore context for animation transformations
        ctx.restore();
        return;
      }

      // Determine x-axis field
      let xAxisField = "";
      let xAxisType: "date" | "name" | "id" | "other" = "other";

      // First priority: Check for date fields (created, updated, etc.)
      const dateFields = [
        "created",
        "createdAt",
        "created_at",
        "updatedAt",
        "updated_at",
        "date",
        "timestamp",
      ];
      for (const field of dateFields) {
        if (chartData.data[0] && field in chartData.data[0]) {
          xAxisField = field;
          xAxisType = "date";
          break;
        }
      }

      // Second priority: Check for name/title fields (only if no date fields found)
      if (!xAxisField) {
        const nameFields = Object.keys(chartData.data[0] || {}).filter(
          (key) =>
            key.toLowerCase().includes("name") ||
            key.toLowerCase().includes("title")
        );
        if (nameFields.length > 0) {
          // Prefer 'title' over 'name' if both exist
          xAxisField =
            nameFields.find((f) => f.toLowerCase().includes("title")) ||
            nameFields[0];
          xAxisType = "name";
        }
      }

      // Third priority: Use ID
      if (!xAxisField && chartData.data[0] && "id" in chartData.data[0]) {
        xAxisField = "id";
        xAxisType = "id";
      }

      // Last resort: Use first available field
      if (!xAxisField) {
        const availableFields = Object.keys(chartData.data[0] || {}).filter(
          (key) => !key.startsWith("_") && key !== "id"
        );
        if (availableFields.length > 0) {
          xAxisField = availableFields[0];
          xAxisType = "other";
        } else {
          xAxisField = "id"; // Ultimate fallback
          xAxisType = "id";
        }
      }

      // Group data based on x-axis type
      let groupedData: { label: string; count: number; table: string }[] = [];

      if (xAxisType === "date") {
        // Group by date
        const dateGroups = new Map<
          string,
          { count: number; tables: Set<string> }
        >();

        chartData.data.forEach((item: ChartDataItem) => {
          const dateValue = item[xAxisField];
          if (
            dateValue &&
            (typeof dateValue === "string" ||
              typeof dateValue === "number" ||
              dateValue instanceof Date)
          ) {
            const date = new Date(dateValue);
            const dateKey = date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });

            if (!dateGroups.has(dateKey)) {
              dateGroups.set(dateKey, { count: 0, tables: new Set() });
            }

            const group = dateGroups.get(dateKey)!;
            group.count++;
            group.tables.add(item._table);
          }
        });

        // Convert to array and sort by date
        groupedData = Array.from(dateGroups.entries())
          .map(([label, data]) => ({
            label,
            count: data.count,
            table: Array.from(data.tables).join(", "),
          }))
          .sort((a, b) => {
            const dateA = new Date(a.label);
            const dateB = new Date(b.label);
            return dateA.getTime() - dateB.getTime();
          });
      } else {
        // Group by unique values
        const valueGroups = new Map<string, { count: number; table: string }>();

        chartData.data.forEach((item) => {
          const value = String(item[xAxisField] || "Unknown");
          if (!valueGroups.has(value)) {
            valueGroups.set(value, { count: 0, table: item._table });
          }
          valueGroups.get(value)!.count++;
        });

        groupedData = Array.from(valueGroups.entries()).map(
          ([label, data]) => ({
            label,
            count: data.count,
            table: data.table,
          })
        ); // No limit - show all data
      }

      const maxItems = Math.min(groupedData.length, 30); // Show more items in regular charts
      const barWidth = (width * 0.8) / maxItems;
      const barSpacing = barWidth * 0.1;
      const chartHeight = height * 0.5;
      const chartY = height * 0.7;
      const startX = width * 0.1;

      // Chart area background
      ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
      ctx.fillRect(
        startX - 50,
        chartY - chartHeight - 50,
        width * 0.8 + 100,
        chartHeight + 100
      );
      ctx.strokeStyle = "rgba(0, 255, 255, 0.3)";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        startX - 50,
        chartY - chartHeight - 50,
        width * 0.8 + 100,
        chartHeight + 100
      );

      const maxValue = Math.max(...groupedData.map((d) => d.count));

      // Draw bars for grouped data
      groupedData.forEach((group, i) => {
        const tableIndex =
          chartData.tables.indexOf(group.table.split(", ")[0]) || 0;
        const barHeight = (group.count / maxValue) * chartHeight * 0.8;
        const x = startX + i * (barWidth + barSpacing);
        const y = chartY - barHeight;

        // Bar gradient based on table
        const gradient = ctx.createLinearGradient(x, y, x, chartY);
        const colors = [
          ["#00FFFF", "#00CED1", "#006B6B"],
          ["#FFD700", "#FFA500", "#B8860B"],
          ["#FF69B4", "#FF1493", "#8B008B"],
          ["#00FF00", "#32CD32", "#006400"],
        ];
        const colorSet = colors[tableIndex % colors.length];
        gradient.addColorStop(0, colorSet[0]);
        gradient.addColorStop(0.5, colorSet[1]);
        gradient.addColorStop(1, colorSet[2]);

        // Draw bar
        ctx.fillStyle = gradient;
        ctx.shadowBlur = 15;
        ctx.shadowColor = colorSet[0];
        ctx.fillRect(x, y, barWidth * 0.8, barHeight);

        // Bar value
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "12px monospace";
        ctx.textAlign = "center";
        ctx.shadowBlur = 5;
        ctx.fillText(group.count.toString(), x + barWidth / 2, y - 5);

        // X-axis label
        ctx.save();
        ctx.translate(x + barWidth / 2, chartY + 10);
        ctx.rotate(-Math.PI / 4);
        ctx.fillStyle = colorSet[0];
        ctx.font = "10px monospace";
        ctx.textAlign = "right";
        ctx.fillText(group.label, 0, 0);
        ctx.restore();
      });

      // Y-axis label
      ctx.fillStyle = "#00FFFF";
      ctx.font = "14px monospace";
      ctx.textAlign = "center";
      ctx.save();
      ctx.translate(startX - 40, height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText("COUNT", 0, 0);
      ctx.restore();

      // X-axis label
      ctx.fillStyle = "#00FFFF";
      ctx.font = "14px monospace";
      ctx.textAlign = "center";
      const xLabel =
        xAxisType === "date"
          ? "DATE"
          : xAxisType === "name"
          ? xAxisField.toUpperCase()
          : xAxisType === "id"
          ? "ID"
          : xAxisField.toUpperCase();
      ctx.fillText(xLabel, width / 2, chartY + 60);

      // X-axis line
      ctx.strokeStyle = "#00FFFF";
      ctx.lineWidth = 2;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(startX - 20, chartY);
      ctx.lineTo(startX + maxItems * (barWidth + barSpacing), chartY);
      ctx.stroke();
    } else {
      // No data message
      ctx.fillStyle = "#FFD700";
      ctx.font = "20px monospace";
      ctx.textAlign = "center";
      ctx.fillText("NO DATA AVAILABLE", width / 2, height / 2);
    }

    // Exit hint background
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(width / 2 - 150, height - 50, 300, 30);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(width / 2 - 150, height - 50, 300, 30);

    // Exit hint
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "14px monospace";
    ctx.textAlign = "center";
    ctx.shadowBlur = 5;
    ctx.shadowColor = "#FFFFFF";
    ctx.fillText("SWIPE LEFT OR RIGHT TO RETURN", width / 2, height - 30);

    // Restore context for animation transformations
    ctx.restore();
  };

  // Initialize tables when available
  useEffect(() => {
    if (!tablesLoading && !tablesInitialized.current) {
      const displayTables =
        availableTables.length > 0
          ? availableTables
          : ["users", "posts", "comments", "products"];

      // Create table objects aligned at the top
      const tableObjects: TableObject[] = displayTables.map(
        (tableName, index) => ({
          id: `${tableName}-${Date.now()}-${index}`,
          name: tableName,
          x: 0.1 + index * 0.15, // Space tables horizontally
          y: 0.1, // Align at top
          isDragging: false,
        })
      );

      tablesRef.current = tableObjects;
      tablesInitialized.current = true;
    }
  }, [availableTables, tablesLoading]);

  useEffect(() => {
    if (!videoRef.current || !canvasRef.current) return;

    let animationId: number;
    let renderAnimationId: number;
    let stream: MediaStream | null = null;

    const setupCamera = async () => {
      try {
        // First, get the camera stream with the selected device
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: cameraId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;

          // Wait for video to be ready
          await new Promise((resolve) => {
            videoRef.current!.onloadedmetadata = () => {
              videoRef.current!.play();
              resolve(true);
            };
          });
        }

        // Initialize MediaPipe hands
        const hands = new Hands({
          locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
          },
        });

        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        hands.onResults((results: Results) => {
          handResultsRef.current = results;
          setIsLoading(false);
        });

        // Separate render loop for smooth animation
        let lastFrameTime = 0;
        const targetFPS = 30;
        const frameInterval = 1000 / targetFPS;

        const renderLoop = (currentTime: number) => {
          if (!canvasRef.current || !videoRef.current) return;

          // Limit to 30 FPS
          if (currentTime - lastFrameTime < frameInterval) {
            renderAnimationId = requestAnimationFrame(renderLoop);
            return;
          }
          lastFrameTime = currentTime;

          const canvasCtx = canvasRef.current.getContext("2d");
          if (!canvasCtx) return;

          canvasRef.current.width = window.innerWidth;
          canvasRef.current.height = window.innerHeight;

          canvasCtx.save();

          // Always draw video first (for background in chart view) with aspect ratio preserved
          const videoWidth = videoRef.current.videoWidth;
          const videoHeight = videoRef.current.videoHeight;
          const canvasWidth = canvasRef.current.width;
          const canvasHeight = canvasRef.current.height;

          // Calculate scale to cover the entire canvas while preserving aspect ratio
          const scale = Math.max(
            canvasWidth / videoWidth,
            canvasHeight / videoHeight
          );
          const scaledWidth = videoWidth * scale;
          const scaledHeight = videoHeight * scale;

          // Center the video
          const offsetX = (canvasWidth - scaledWidth) / 2;
          const offsetY = (canvasHeight - scaledHeight) / 2;

          // Mirror the video horizontally
          canvasCtx.translate(offsetX + scaledWidth, offsetY);
          canvasCtx.scale(-1, 1);

          canvasCtx.drawImage(
            videoRef.current,
            0,
            0,
            videoWidth,
            videoHeight, // Source
            0,
            0,
            scaledWidth,
            scaledHeight // Destination (adjusted for mirroring)
          );

          // Reset transformation for other elements
          canvasCtx.setTransform(1, 0, 0, 1, 0, 0);

          // If showing chart, check for swipe gesture to exit
          if (showChart) {
            const results = handResultsRef.current;
            if (
              results &&
              results.multiHandLandmarks &&
              results.multiHandLandmarks.length > 0
            ) {
              const landmarks = results.multiHandLandmarks[0];
              const indexTip = landmarks[8]; // Use index finger for swipe
              const currentTime = Date.now();

              // Check if index finger is extended (swipe gesture)
              const indexExtended = indexTip.y < landmarks[6].y; // Index tip above PIP joint

              if (indexExtended) {
                const currentX = 1 - indexTip.x; // Mirror X coordinate
                const currentY = indexTip.y;

                if (!swipeStateRef.current.isTracking) {
                  // Start tracking swipe
                  swipeStateRef.current = {
                    isTracking: true,
                    startX: currentX,
                    startY: currentY,
                    currentX: currentX,
                    currentY: currentY,
                    startTime: currentTime,
                  };
                } else {
                  // Continue tracking
                  swipeStateRef.current.currentX = currentX;
                  swipeStateRef.current.currentY = currentY;

                  // Check for swipe completion
                  const deltaX = currentX - swipeStateRef.current.startX;
                  const deltaY = Math.abs(
                    currentY - swipeStateRef.current.startY
                  );
                  const timeElapsed =
                    currentTime - swipeStateRef.current.startTime;

                  // Swipe conditions: horizontal movement > 0.3, vertical < 0.2, time < 1000ms
                  if (
                    Math.abs(deltaX) > 0.3 &&
                    deltaY < 0.2 &&
                    timeElapsed < 1000
                  ) {
                    console.log("Swipe detected, exiting chart view");
                    hideChartWithAnimation();
                    swipeStateRef.current.isTracking = false;
                  } else if (timeElapsed > 1000) {
                    // Reset if too slow
                    swipeStateRef.current.isTracking = false;
                  }
                }

                // Draw swipe indicator
                if (swipeStateRef.current.isTracking) {
                  canvasCtx.strokeStyle = "#FFD700";
                  canvasCtx.lineWidth = 3;
                  canvasCtx.shadowBlur = 10;
                  canvasCtx.shadowColor = "#FFD700";
                  canvasCtx.beginPath();
                  canvasCtx.moveTo(
                    mirrorX(
                      swipeStateRef.current.startX,
                      canvasRef.current?.width || 0
                    ),
                    swipeStateRef.current.startY *
                      (canvasRef.current?.height || 0)
                  );
                  canvasCtx.lineTo(
                    mirrorX(currentX, canvasRef.current?.width || 0),
                    currentY * (canvasRef.current?.height || 0)
                  );
                  canvasCtx.stroke();
                }
              } else {
                // Reset swipe tracking when finger not extended
                swipeStateRef.current.isTracking = false;
              }

              // Draw hand skeleton even in chart view
              for (const hand of results.multiHandLandmarks) {
                // Draw connections
                HAND_CONNECTIONS.forEach((connection) => {
                  const [start, end] = connection;
                  const startPoint = hand[start];
                  const endPoint = hand[end];

                  canvasCtx.strokeStyle = "#00FFFF";
                  canvasCtx.lineWidth = 2;
                  canvasCtx.beginPath();
                  canvasCtx.moveTo(
                    mirrorX(startPoint.x, canvasRef.current?.width || 0),
                    startPoint.y * (canvasRef.current?.height || 0)
                  );
                  canvasCtx.lineTo(
                    mirrorX(endPoint.x, canvasRef.current?.width || 0),
                    endPoint.y * (canvasRef.current?.height || 0)
                  );
                  canvasCtx.stroke();
                });

                // Draw landmarks
                hand.forEach((landmark) => {
                  const x = mirrorX(landmark.x, canvasRef.current?.width || 0);
                  const y = landmark.y * (canvasRef.current?.height || 0);

                  canvasCtx.fillStyle = "#FFD700";
                  canvasCtx.beginPath();
                  canvasCtx.arc(x, y, 4, 0, 2 * Math.PI);
                  canvasCtx.fill();
                });
              }
            }

            canvasCtx.restore();
            renderAnimationId = requestAnimationFrame(renderLoop);
            return;
          }

          // Create a subtle dark overlay for better contrast
          canvasCtx.fillStyle = "rgba(0, 0, 0, 0.3)";
          canvasCtx.fillRect(
            0,
            0,
            canvasRef.current?.width || 0,
            canvasRef.current?.height || 0
          );

          // Add scanline effect
          const time = Date.now() * 0.001;
          canvasCtx.strokeStyle = "rgba(0, 255, 255, 0.03)";
          canvasCtx.lineWidth = 1;
          for (let y = 0; y < (canvasRef.current?.height || 0); y += 3) {
            if (Math.sin(y * 0.01 + time) > 0.98) {
              canvasCtx.beginPath();
              canvasCtx.moveTo(0, y);
              canvasCtx.lineTo(canvasRef.current?.width || 0, y);
              canvasCtx.stroke();
            }
          }

          // Draw table objects
          const currentTables = tablesRef.current;
          if (!canvasRef.current) return;

          currentTables.forEach((table) => {
            const tableX = table.x * canvasRef.current!.width;
            const tableY = table.y * canvasRef.current!.height;
            const size = 80;

            // Holographic glow effect
            const gradient = canvasCtx.createRadialGradient(
              tableX,
              tableY,
              0,
              tableX,
              tableY,
              size
            );
            if (table.isDragging) {
              gradient.addColorStop(0, "rgba(255, 136, 0, 0.3)");
              gradient.addColorStop(0.5, "rgba(255, 136, 0, 0.1)");
              gradient.addColorStop(1, "rgba(255, 136, 0, 0)");
            } else {
              gradient.addColorStop(0, "rgba(0, 255, 255, 0.2)");
              gradient.addColorStop(0.5, "rgba(0, 255, 255, 0.05)");
              gradient.addColorStop(1, "rgba(0, 255, 255, 0)");
            }
            canvasCtx.fillStyle = gradient;
            canvasCtx.fillRect(
              tableX - size,
              tableY - size,
              size * 2,
              size * 2
            );

            // Hexagonal border
            const hexSize = size / 2;
            canvasCtx.strokeStyle = table.isDragging ? "#FF8800" : "#00FFFF";
            canvasCtx.lineWidth = 2;
            canvasCtx.shadowBlur = 10;
            canvasCtx.shadowColor = table.isDragging ? "#FF8800" : "#00FFFF";

            canvasCtx.beginPath();
            for (let i = 0; i < 6; i++) {
              const angle = (Math.PI / 3) * i;
              const x = tableX + hexSize * Math.cos(angle);
              const y = tableY + hexSize * Math.sin(angle);
              if (i === 0) canvasCtx.moveTo(x, y);
              else canvasCtx.lineTo(x, y);
            }
            canvasCtx.closePath();
            canvasCtx.stroke();

            // Inner hexagon
            canvasCtx.strokeStyle = table.isDragging
              ? "rgba(255, 136, 0, 0.5)"
              : "rgba(0, 255, 255, 0.5)";
            canvasCtx.lineWidth = 1;
            const innerHexSize = hexSize * 0.8;
            canvasCtx.beginPath();
            for (let i = 0; i < 6; i++) {
              const angle = (Math.PI / 3) * i;
              const x = tableX + innerHexSize * Math.cos(angle);
              const y = tableY + innerHexSize * Math.sin(angle);
              if (i === 0) canvasCtx.moveTo(x, y);
              else canvasCtx.lineTo(x, y);
            }
            canvasCtx.closePath();
            canvasCtx.stroke();

            // Table icon - holographic grid
            canvasCtx.strokeStyle = table.isDragging ? "#FFA500" : "#00CED1";
            canvasCtx.lineWidth = 1;
            canvasCtx.shadowBlur = 5;

            const gridSize = 20;
            // Draw grid pattern
            for (let i = -1; i <= 1; i++) {
              canvasCtx.beginPath();
              canvasCtx.moveTo(tableX - gridSize, tableY + (i * gridSize) / 2);
              canvasCtx.lineTo(tableX + gridSize, tableY + (i * gridSize) / 2);
              canvasCtx.stroke();

              canvasCtx.beginPath();
              canvasCtx.moveTo(tableX + (i * gridSize) / 2, tableY - gridSize);
              canvasCtx.lineTo(tableX + (i * gridSize) / 2, tableY + gridSize);
              canvasCtx.stroke();
            }

            // Table name with futuristic font
            canvasCtx.shadowBlur = 0;
            canvasCtx.fillStyle = table.isDragging ? "#FFD700" : "#00FFFF";
            canvasCtx.font = "bold 14px monospace";
            canvasCtx.textAlign = "center";
            canvasCtx.letterSpacing = "2px";

            // Text background
            const textMetrics = canvasCtx.measureText(table.name.toUpperCase());
            const textWidth = textMetrics.width;
            const textHeight = 20;

            canvasCtx.fillStyle = "rgba(0, 0, 0, 0.7)";
            canvasCtx.fillRect(
              tableX - textWidth / 2 - 10,
              tableY + hexSize + 10,
              textWidth + 20,
              textHeight
            );

            // Text border
            canvasCtx.strokeStyle = table.isDragging ? "#FF8800" : "#00FFFF";
            canvasCtx.lineWidth = 1;
            canvasCtx.strokeRect(
              tableX - textWidth / 2 - 10,
              tableY + hexSize + 10,
              textWidth + 20,
              textHeight
            );

            // Draw text
            canvasCtx.fillStyle = table.isDragging ? "#FFD700" : "#00FFFF";
            canvasCtx.fillText(
              table.name.toUpperCase(),
              tableX,
              tableY + hexSize + 24
            );
          });

          // Draw drop zone
          const dropZoneX = dropZone.x * canvasRef.current.width;
          const dropZoneY = dropZone.y * canvasRef.current.height;
          const dropZoneWidth = dropZone.width * canvasRef.current.width;
          const dropZoneHeight = dropZone.height * canvasRef.current.height;

          // Drop zone background
          canvasCtx.fillStyle = "rgba(0, 255, 255, 0.05)";
          canvasCtx.fillRect(
            dropZoneX - dropZoneWidth / 2,
            dropZoneY - dropZoneHeight / 2,
            dropZoneWidth,
            dropZoneHeight
          );

          // Drop zone border
          canvasCtx.strokeStyle = "#00FFFF";
          canvasCtx.lineWidth = 2;
          canvasCtx.setLineDash([10, 5]);
          canvasCtx.shadowBlur = 10;
          canvasCtx.shadowColor = "#00FFFF";
          canvasCtx.strokeRect(
            dropZoneX - dropZoneWidth / 2,
            dropZoneY - dropZoneHeight / 2,
            dropZoneWidth,
            dropZoneHeight
          );
          canvasCtx.setLineDash([]);

          // Drop zone label
          canvasCtx.fillStyle = "#00FFFF";
          canvasCtx.font = "bold 16px monospace";
          canvasCtx.textAlign = "center";
          canvasCtx.shadowBlur = 0;
          canvasCtx.fillText(
            "DROP ZONE",
            dropZoneX,
            dropZoneY - dropZoneHeight / 2 - 10
          );

          // Show dropped tables count
          if (droppedTablesRef.current.length > 0) {
            canvasCtx.fillStyle = "#FFD700";
            canvasCtx.font = "14px monospace";
            canvasCtx.fillText(
              `${droppedTablesRef.current.length} TABLE${
                droppedTablesRef.current.length > 1 ? "S" : ""
              }`,
              dropZoneX,
              dropZoneY
            );
          }

          // Generate button
          const buttonX = dropZoneX + dropZoneWidth / 2 + 60;
          const buttonY = dropZoneY;
          const buttonWidth = 120;
          const buttonHeight = 40;

          // Button glow effect when hovering
          if (generateButtonHoverRef.current) {
            const glowGradient = canvasCtx.createRadialGradient(
              buttonX,
              buttonY,
              0,
              buttonX,
              buttonY,
              80
            );
            glowGradient.addColorStop(0, "rgba(255, 136, 0, 0.3)");
            glowGradient.addColorStop(1, "rgba(255, 136, 0, 0)");
            canvasCtx.fillStyle = glowGradient;
            canvasCtx.fillRect(buttonX - 80, buttonY - 80, 160, 160);
          }

          // Button background
          canvasCtx.fillStyle = generateButtonHoverRef.current
            ? "#FF8800"
            : "#00CED1";
          canvasCtx.shadowBlur = 15;
          canvasCtx.shadowColor = generateButtonHoverRef.current
            ? "#FF8800"
            : "#00CED1";
          canvasCtx.fillRect(
            buttonX - buttonWidth / 2,
            buttonY - buttonHeight / 2,
            buttonWidth,
            buttonHeight
          );

          // Button border
          canvasCtx.strokeStyle = generateButtonHoverRef.current
            ? "#FFD700"
            : "#00FFFF";
          canvasCtx.lineWidth = 2;
          canvasCtx.strokeRect(
            buttonX - buttonWidth / 2,
            buttonY - buttonHeight / 2,
            buttonWidth,
            buttonHeight
          );

          // Button text
          canvasCtx.fillStyle = "#000000";
          canvasCtx.font = "bold 16px monospace";
          canvasCtx.textAlign = "center";
          canvasCtx.shadowBlur = 0;
          canvasCtx.fillText("GENERATE", buttonX, buttonY + 5);

          // Draw toast notification
          if (toast) {
            const toastWidth = 400;
            const toastHeight = 60;
            const toastX = canvasRef.current.width / 2 - toastWidth / 2;
            const toastY = 100;

            // Toast background
            canvasCtx.fillStyle =
              toast.type === "error"
                ? "rgba(255, 0, 0, 0.9)"
                : "rgba(0, 255, 255, 0.9)";
            canvasCtx.shadowBlur = 20;
            canvasCtx.shadowColor =
              toast.type === "error" ? "#FF0000" : "#00FFFF";
            canvasCtx.fillRect(toastX, toastY, toastWidth, toastHeight);

            // Toast border
            canvasCtx.strokeStyle =
              toast.type === "error" ? "#FF6666" : "#00FFFF";
            canvasCtx.lineWidth = 2;
            canvasCtx.strokeRect(toastX, toastY, toastWidth, toastHeight);

            // Toast text
            canvasCtx.fillStyle = "#FFFFFF";
            canvasCtx.font = "bold 16px monospace";
            canvasCtx.textAlign = "center";
            canvasCtx.shadowBlur = 0;
            canvasCtx.fillText(
              toast.message,
              canvasRef.current.width / 2,
              toastY + toastHeight / 2 + 5
            );
          }

          // Process hand landmarks if available
          const results = handResultsRef.current;
          if (
            results &&
            results.multiHandLandmarks &&
            results.multiHandLandmarks.length > 0
          ) {
            for (let i = 0; i < results.multiHandLandmarks.length; i++) {
              const landmarks = results.multiHandLandmarks[i];

              // Draw hand skeleton with holographic effect
              canvasCtx.shadowBlur = 15;
              canvasCtx.shadowColor = "#00FFFF";

              // Draw connections with gradient
              HAND_CONNECTIONS.forEach((connection) => {
                const [start, end] = connection;
                const startPoint = landmarks[start];
                const endPoint = landmarks[end];

                const startX = mirrorX(
                  startPoint.x,
                  canvasRef.current?.width || 0
                );
                const startY = startPoint.y * (canvasRef.current?.height || 0);
                const endX = mirrorX(endPoint.x, canvasRef.current?.width || 0);
                const endY = endPoint.y * (canvasRef.current?.height || 0);

                const gradient = canvasCtx.createLinearGradient(
                  startX,
                  startY,
                  endX,
                  endY
                );
                gradient.addColorStop(0, "#00FFFF");
                gradient.addColorStop(0.5, "#00CED1");
                gradient.addColorStop(1, "#00FFFF");

                canvasCtx.strokeStyle = gradient;
                canvasCtx.lineWidth = 3;
                canvasCtx.beginPath();
                canvasCtx.moveTo(startX, startY);
                canvasCtx.lineTo(endX, endY);
                canvasCtx.stroke();
              });

              // Draw landmarks as glowing nodes
              landmarks.forEach((landmark, index) => {
                const x = mirrorX(landmark.x, canvasRef.current?.width || 0);
                const y = landmark.y * (canvasRef.current?.height || 0);

                // Outer glow
                const glowGradient = canvasCtx.createRadialGradient(
                  x,
                  y,
                  0,
                  x,
                  y,
                  10
                );
                glowGradient.addColorStop(0, "rgba(255, 136, 0, 0.8)");
                glowGradient.addColorStop(0.5, "rgba(255, 136, 0, 0.3)");
                glowGradient.addColorStop(1, "rgba(255, 136, 0, 0)");

                canvasCtx.fillStyle = glowGradient;
                canvasCtx.fillRect(x - 10, y - 10, 20, 20);

                // Core node
                canvasCtx.fillStyle = "#FFD700";
                canvasCtx.shadowBlur = 10;
                canvasCtx.shadowColor = "#FFD700";
                canvasCtx.beginPath();
                canvasCtx.arc(x, y, 4, 0, 2 * Math.PI);
                canvasCtx.fill();

                // Special highlighting for thumb and index tips (pinch points)
                if (index === 4 || index === 8) {
                  canvasCtx.strokeStyle = "#FF8800";
                  canvasCtx.lineWidth = 2;
                  canvasCtx.beginPath();
                  canvasCtx.arc(x, y, 8, 0, 2 * Math.PI);
                  canvasCtx.stroke();
                }
              });

              // Get all relevant landmarks
              const thumbTip = landmarks[4];
              const indexTip = landmarks[8];

              // Calculate distance between thumb and index finger for pinch
              const distance = Math.sqrt(
                Math.pow(thumbTip.x - indexTip.x, 2) +
                  Math.pow(thumbTip.y - indexTip.y, 2)
              );

              // Pinch threshold (adjust as needed)
              const pinchThreshold = 0.05;
              const isPinching = distance < pinchThreshold;
              const pinchState = pinchStateRef.current;

              if (isPinching) {
                // Calculate pinch center (mirror X coordinate)
                const pinchX = 1 - (thumbTip.x + indexTip.x) / 2; // Mirror the X coordinate
                const pinchY = (thumbTip.y + indexTip.y) / 2;

                if (!pinchState.isPinching) {
                  // Start pinching - check if near generate button first
                  const buttonX =
                    (dropZoneX + dropZoneWidth / 2 + 60) /
                    canvasRef.current.width;
                  const buttonY = dropZoneY / canvasRef.current.height;
                  const buttonWidth = 120 / canvasRef.current.width;
                  const buttonHeight = 40 / canvasRef.current.height;

                  const buttonLeft = buttonX - buttonWidth / 2;
                  const buttonRight = buttonX + buttonWidth / 2;
                  const buttonTop = buttonY - buttonHeight / 2;
                  const buttonBottom = buttonY + buttonHeight / 2;

                  if (
                    pinchX >= buttonLeft &&
                    pinchX <= buttonRight &&
                    pinchY >= buttonTop &&
                    pinchY <= buttonBottom
                  ) {
                    // Pinching the generate button
                    generateButtonHoverRef.current = true;
                    if (!buttonClickedRef.current) {
                      buttonClickedRef.current = true;

                      if (droppedTablesRef.current.length === 0) {
                        showToast(
                          "Please drop at least one table into the drop zone",
                          "error"
                        );
                      } else {
                        console.log(
                          "Generating chart with tables:",
                          droppedTablesRef.current
                        );
                        showToast(
                          `Creating chart with ${droppedTablesRef.current.length} table(s)`,
                          "info"
                        );

                        // Fetch data and show chart
                        fetchTableData([...droppedTablesRef.current]);

                        // Delay to show toast before chart
                        setTimeout(() => {
                          showChartWithAnimation();
                        }, 500);
                      }
                    }
                  } else {
                    // Check if near any table
                    const tableSize =
                      60 /
                      Math.min(
                        canvasRef.current.width,
                        canvasRef.current.height
                      );

                    for (const table of currentTables) {
                      const distToTable = Math.sqrt(
                        Math.pow(pinchX - table.x, 2) +
                          Math.pow(pinchY - table.y, 2)
                      );

                      if (distToTable < tableSize) {
                        // Start dragging this table
                        draggedTableRef.current = table.id;
                        table.isDragging = true;
                        break;
                      }
                    }
                  }

                  pinchStateRef.current = {
                    isPinching: true,
                    x: pinchX,
                    y: pinchY,
                  };
                } else {
                  // Continue pinching - update dragged table position
                  if (draggedTableRef.current) {
                    const deltaX = pinchX - pinchState.x;
                    const deltaY = pinchY - pinchState.y;

                    const draggedTable = currentTables.find(
                      (t) => t.id === draggedTableRef.current
                    );
                    if (draggedTable) {
                      draggedTable.x = Math.max(
                        0.05,
                        Math.min(0.95, draggedTable.x + deltaX)
                      );
                      draggedTable.y = Math.max(
                        0.05,
                        Math.min(0.95, draggedTable.y + deltaY)
                      );
                    }
                  }

                  pinchStateRef.current = {
                    isPinching: true,
                    x: pinchX,
                    y: pinchY,
                  };
                }

                // Draw pinch indicator with holographic effect
                const pinchXPixel = pinchX * canvasRef.current.width;
                const pinchYPixel = pinchY * canvasRef.current.height;

                // Animated rings
                const ringTime = Date.now() * 0.003;
                canvasCtx.shadowBlur = 20;
                canvasCtx.shadowColor = "#FF8800";

                for (let i = 0; i < 3; i++) {
                  const radius = 15 + i * 10 + Math.sin(ringTime + i) * 5;
                  const opacity = 0.5 - i * 0.15;

                  canvasCtx.strokeStyle = `rgba(255, 136, 0, ${opacity})`;
                  canvasCtx.lineWidth = 2 - i * 0.5;
                  canvasCtx.beginPath();
                  canvasCtx.arc(
                    pinchXPixel,
                    pinchYPixel,
                    radius,
                    0,
                    2 * Math.PI
                  );
                  canvasCtx.stroke();
                }

                // Energy core
                const coreGradient = canvasCtx.createRadialGradient(
                  pinchXPixel,
                  pinchYPixel,
                  0,
                  pinchXPixel,
                  pinchYPixel,
                  15
                );
                coreGradient.addColorStop(0, "rgba(255, 215, 0, 0.9)");
                coreGradient.addColorStop(0.5, "rgba(255, 136, 0, 0.6)");
                coreGradient.addColorStop(1, "rgba(255, 136, 0, 0)");

                canvasCtx.fillStyle = coreGradient;
                canvasCtx.fillRect(pinchXPixel - 20, pinchYPixel - 20, 40, 40);
              } else if (pinchState.isPinching) {
                // Release pinch
                generateButtonHoverRef.current = false; // Reset button state
                buttonClickedRef.current = false; // Reset click state

                if (draggedTableRef.current) {
                  const draggedTable = currentTables.find(
                    (t) => t.id === draggedTableRef.current
                  );
                  if (draggedTable) {
                    draggedTable.isDragging = false;

                    // Check if table was dropped in drop zone
                    const tableX = draggedTable.x;
                    const tableY = draggedTable.y;
                    const dropZoneLeft = dropZone.x - dropZone.width / 2;
                    const dropZoneRight = dropZone.x + dropZone.width / 2;
                    const dropZoneTop = dropZone.y - dropZone.height / 2;
                    const dropZoneBottom = dropZone.y + dropZone.height / 2;

                    if (
                      tableX >= dropZoneLeft &&
                      tableX <= dropZoneRight &&
                      tableY >= dropZoneTop &&
                      tableY <= dropZoneBottom
                    ) {
                      // Add to dropped tables if not already there
                      if (
                        !droppedTablesRef.current.includes(draggedTable.name)
                      ) {
                        droppedTablesRef.current.push(draggedTable.name);
                      }
                      // Table stays in drop zone - no position change
                    }
                  }
                  draggedTableRef.current = null;
                }
                pinchStateRef.current = { isPinching: false, x: 0, y: 0 };
              }
            }
          } else if (pinchStateRef.current.isPinching) {
            // No hands detected, release pinch
            generateButtonHoverRef.current = false; // Reset button state
            if (draggedTableRef.current) {
              const draggedTable = currentTables.find(
                (t) => t.id === draggedTableRef.current
              );
              if (draggedTable) {
                draggedTable.isDragging = false;
              }
              draggedTableRef.current = null;
            }
            pinchStateRef.current = { isPinching: false, x: 0, y: 0 };
          }

          canvasCtx.restore();
          renderAnimationId = requestAnimationFrame(renderLoop);
        };

        // Manual frame processing instead of using Camera utility
        const processFrame = async () => {
          if (videoRef.current && videoRef.current.readyState === 4) {
            await hands.send({ image: videoRef.current });
          }
          animationId = requestAnimationFrame(processFrame);
        };

        processFrame();
        renderLoop(0);
      } catch (error) {
        console.error("Error starting camera:", error);
        setIsLoading(false);
      }
    };

    setupCamera();

    return () => {
      // Cancel animation frames
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      if (renderAnimationId) {
        cancelAnimationFrame(renderAnimationId);
      }

      // Stop all video tracks
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, showChart, toast, chartData, loadingData, chartAnimationState]);

  return (
    <div className="fixed inset-0 w-screen h-screen bg-black overflow-hidden">
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover z-0"
        autoPlay
        playsInline
        muted
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-10"
        style={{ width: "100%", height: "100%" }}
      />
      {(showChart || chartAnimationState !== "hidden") && (
        <canvas
          ref={chartCanvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none z-20"
          style={{ width: "100%", height: "100%" }}
        />
      )}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-90">
          <div className="text-center">
            <div className="relative">
              {/* Animated arc loader */}
              <svg className="w-32 h-32 animate-spin" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="#00FFFF"
                  strokeWidth="2"
                  strokeDasharray="220"
                  strokeDashoffset="50"
                  opacity="0.3"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="#00FFFF"
                  strokeWidth="3"
                  strokeDasharray="70 200"
                  strokeDashoffset="0"
                  filter="drop-shadow(0 0 10px #00FFFF)"
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    values="0;-270"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                </circle>
              </svg>

              {/* Center text */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-cyan-400 font-mono text-sm">
                  INITIALIZING
                </div>
              </div>
            </div>

            <div className="mt-4 text-cyan-300 font-mono text-lg tracking-wider">
              NEURAL INTERFACE LOADING...
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HandTracking;
